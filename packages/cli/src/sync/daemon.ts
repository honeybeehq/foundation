import { watch, readFileSync, mkdirSync, type FSWatcher } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { loadChain } from 'foundation-engine'
import { encodeBlob, decodeBlob, importChangeBlobs } from '../../../engine/src/chain/blob.js'
import { acquireDocumentLock } from '../document-lock.js'
import { updateDocument } from '../disk.js'
import { liveDesigns, replicaRoot, readSyncState, writeSyncState, type LiveDesign } from '../sync-store.js'
import { CatalogueQueue } from './catalogue.js'
import { CombBridge, validateAppendReceipt, type Frame } from './bridge.js'

export interface CombConfig { binary: string; args: string[]; node?: { id: string; name: string } }
export function feedName(design: LiveDesign): string { return `foundation/${design.workspace}/${design.product}/${design.docId}` }
// Comb's supported log names exclude '/'. Keep the logical address and map it without collisions.
export function combLog(design: LiveDesign): string { return `foundation-${createHash('sha256').update(feedName(design)).digest('hex')}` }
export function copyKey(design: LiveDesign): string { return createHash('sha256').update(JSON.stringify([feedName(design), design.file])).digest('hex') }
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
function page(frame: Frame, cursor: string): { blobs: Uint8Array[]; next: string } {
  if (!Array.isArray(frame.events) || typeof frame.next_cursor !== 'string' || !/^[1-9][0-9]*$/.test(frame.next_cursor)) throw new Error('invalid Comb page')
  let expected = BigInt(cursor)
  const blobs = frame.events.map((event: unknown) => {
    const e = event as Frame
    if (!e || e.seq !== String(expected++) || typeof e.payload_hex !== 'string' || !/^(?:[a-fA-F0-9]{2})+$/.test(e.payload_hex)) throw new Error('invalid Comb event or cursor gap')
    const bytes = Buffer.from(e.payload_hex, 'hex'); decodeBlob(bytes); return bytes
  })
  if (String(expected) !== frame.next_cursor) throw new Error('invalid Comb next cursor')
  return { blobs, next: frame.next_cursor }
}
export async function serveSync(config: CombConfig, signal: AbortSignal, log: (text: string) => void): Promise<void> {
  mkdirSync(replicaRoot(), { recursive: true })
  const release = acquireDocumentLock(join(replicaRoot(), 'daemon'), 100)
  const catalogueQueue = new CatalogueQueue(config, signal, log)
  const workers = new Map<string, { controller: AbortController; done: Promise<void>; registration: string }>()
  async function run(design: LiveDesign, signal: AbortSignal): Promise<void> {
    updateDocument(design.file, chain => {
      if (chain.docId() !== design.docId) throw new Error('live path now holds another design')
      chain.upgradeStorage()
    }, true)
    const key = copyKey(design), state = readSyncState(key), feed = combLog(design)
    let bridge: CombBridge | undefined, watcher: FSWatcher | undefined, wake: (() => void) | undefined
    const retry = { receive: 250, publish: 250, connection: 250 }
    if (state.lastError && !state.receiveError && !state.publishError && !state.connectionError) state.connectionError = state.lastError
    const updateError = (side: 'receive' | 'publish' | 'connection', error: string | null): void => {
      const field = `${side}Error` as const
      const previous = state.lastError
      state[field] = error
      if (error) state.lastErrorAt = new Date().toISOString()
      state.lastError = [state.receiveError, state.publishError, state.connectionError].filter(Boolean).join('; ') || null
      if (state.lastError !== previous || error) writeSyncState(key, state)
    }
    const succeeded = (side: 'receive' | 'publish'): void => {
      retry[side] = 250; retry.connection = 250
      updateError('connection', null); updateError(side, null)
    }
    let catalogueHead: string | undefined
    const stop = (): void => { bridge?.close(); wake?.() }
    signal.addEventListener('abort', stop)
    try {
      try { watcher = watch(dirname(design.file), (_event, name) => { if (name === null || design.file.endsWith(`/${name}`) || `${design.file}.chain`.endsWith(`/${name}`)) wake?.() }); watcher.on('error', () => watcher?.close()) } catch { /* Poll remains active on unsupported filesystems. */ }
      while (!signal.aborted) {
        let receiveError: unknown, publishingHash: string | undefined
        try {
          bridge = new CombBridge(config.binary, config.args); await bridge.hello()
          const active = bridge
          let failed: unknown
          const follow = (async () => {
            while (!signal.aborted) {
              const response = await active.request('follow', { log: feed, cursor: state.cursor, max_events: 128, max_bytes: 491520, timeout_ms: 1000 })
              if (response.log !== feed) throw new Error('Comb response feed mismatch')
              const incoming = page(response, state.cursor)
              if (incoming.blobs.length) {
                updateDocument(design.file, chain => {
                  if (chain.docId() !== design.docId) throw new Error('live path now holds another design')
                  importChangeBlobs(chain, incoming.blobs)
                }, true)
                // Delivery itself proves durable sharing, even when the append acknowledgement was lost.
                const shared = new Set(state.published)
                for (const blob of incoming.blobs) shared.add(decodeBlob(blob).envelope.hash)
                state.published = [...shared]
                state.cursor = incoming.next; state.updatedAt = new Date().toISOString(); writeSyncState(key, state)
              }
              succeeded('receive')
            }
          })().catch(err => { failed = err; receiveError = err; active.close(); wake?.() })
          try {
            while (!signal.aborted && !failed) {
              const chain = loadChain(readFileSync(`${design.file}.chain`))
              if (chain.docId() !== design.docId) throw new Error('live path now holds another design')
              const published = new Set(state.published)
              const pending = chain.changes().filter(c => !published.has(c.envelope.hash))
              if (state.pending !== pending.length) { state.pending = pending.length; writeSyncState(key, state) }
              if (pending.length) {
                // A persistent bridge renews exclusive feed ownership. Bound each writer
                // batch and send clean EOF, so other nodes can publish through the same log.
                publishingHash = pending[0]!.envelope.hash
                const writer = new CombBridge(config.binary, config.args)
                try {
                  await writer.hello()
                  for (const change of pending.slice(0, 16)) {
                    if (signal.aborted) break
                    publishingHash = change.envelope.hash
                    const bytes = encodeBlob(change.envelope, change.bytes)
                    if (bytes.length > 491520) throw new Error(`change ${change.envelope.hash} exceeds Comb append limit (491520 bytes)`)
                    const receipt = await writer.request('append', { log: feed, idempotency_key: change.envelope.hash, payload_hex: Buffer.from(bytes).toString('hex') })
                    validateAppendReceipt(receipt, feed)
                    if (!state.published.includes(change.envelope.hash)) state.published.push(change.envelope.hash)
                    state.pending = Math.max(0, state.pending - 1); state.updatedAt = new Date().toISOString(); succeeded('publish'); writeSyncState(key, state)
                  }
                } finally { await writer.finish() }
                publishingHash = undefined
              }
              const sharedHashes = new Set(state.published), head = chain.head().hash
              if (!signal.aborted && head !== catalogueHead && chain.changes().every(change => sharedHashes.has(change.envelope.hash))) {
                catalogueHead = head
                catalogueQueue.enqueue(key, design, chain, error => {
                  if (signal.aborted) return
                  if (state.catalogueError !== error) {
                    state.catalogueError = error; writeSyncState(key, state)
                    if (error) log(`${feedName(design)} catalogue: ${error}`)
                  }
                })
              }
              await new Promise<void>(resolve => { const timer = setTimeout(done, 250); function done(): void { clearTimeout(timer); wake = undefined; resolve() }; wake = done })
            }
            if (failed) throw failed
          } finally { active.close(); await follow }
        } catch (err) {
          bridge?.close()
          if (signal.aborted) break
          const side = err === receiveError ? 'receive' : publishingHash ? 'publish' : 'connection'
          const context = side === 'receive' ? `receive cursor ${state.cursor}` : publishingHash ? `publish change ${publishingHash}` : 'connection'
          updateError(side, `${context}: ${err instanceof Error ? err.message : String(err)}`)
          log(`${feedName(design)}: ${state.lastError}`)
          await delay(retry[side]); retry[side] = Math.min(retry[side] * 2, 10000)
        }
      }
    } finally { watcher?.close(); signal.removeEventListener('abort', stop) }
  }
  try {
    while (!signal.aborted) {
      const designs = liveDesigns(log), liveRecords = new Map(designs.map(design => [copyKey(design), JSON.stringify(design)]))
      for (const [key, worker] of workers) if (liveRecords.get(key) !== worker.registration && !worker.controller.signal.aborted) {
        worker.controller.abort()
        void worker.done.finally(() => workers.delete(key))
      }
      for (const design of designs) {
        const key = copyKey(design)
        if (!workers.has(key)) {
          const controller = new AbortController()
          const done = run(design, AbortSignal.any([signal, controller.signal])).catch(err => log(String(err)))
          workers.set(key, { controller, done, registration: JSON.stringify(design) })
        }
      }
      await delay(250)
    }
    await Promise.all([...workers.values()].map(worker => worker.done))
    await catalogueQueue.close()
  } finally { release() }
}
