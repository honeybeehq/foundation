import { AssetSharing } from '../share/assets.js'
import { syncTrace, syncTraceEnabled, syncTraceSpan } from '../sync-trace.js'
import { watch, readFileSync, mkdirSync, statSync, type FSWatcher } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { loadChain } from 'foundation-engine'
import { encodeBlob, decodeBlob, importChangeBlobs } from '../../../engine/src/chain/blob.js'
import { acquireDocumentLock } from '../document-lock.js'
import { updateDocument } from '../disk.js'
import { liveDesigns, replicaRoot, readSyncState, writeSyncState, type LiveDesign } from '../sync-store.js'
import { CatalogueQueue } from './catalogue.js'
import { validateAppendReceipt, type Frame } from './bridge.js'
import { createBridge, configForDesign, shareRelay, maintainKnownRepos, ShareHints, type Bridge } from '../share/transport.js'
import { findShareRoot, readShareConfig, type ShareConfig } from '../share/config.js'
import { followLocalCatalogues } from './catalogue-follower.js'
import { processMaterializeJobs } from './materialize-jobs.js'
import { initializeActivityJournal, recordActivity, closeActivityJournal } from './local-model.js'
import type { FdnChain } from 'foundation-engine'
import { DirectChanges, writeDirectStatus, type DirectConfig } from './direct.js'

export interface CombConfig { binary: string; args: string[]; node?: { id: string; name: string }; direct?: DirectConfig; share?: ShareConfig; shareLog?: string }
export function feedName(design: LiveDesign): string { return `foundation/${design.workspace}/${design.product}/${design.docId}` }
// Comb's supported log names exclude '/'. Keep the logical address and map it without collisions.
export function combLog(design: LiveDesign): string { return `foundation-${createHash('sha256').update(feedName(design)).digest('hex')}` }
export function copyKey(design: LiveDesign): string { return createHash('sha256').update(JSON.stringify([feedName(design), design.file])).digest('hex') }
/** Input is changes() Lamport order, including every native dependency. */
export function publishablePrefix<T extends { envelope: { hash: string } }>(unshared: T[], received: ReadonlyMap<string, number> | undefined, now = Date.now()): T[] {
  const waitingParent = unshared.findIndex(change => (received?.get(change.envelope.hash) ?? 0) > now)
  return waitingParent < 0 ? unshared : unshared.slice(0, waitingParent)
}
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
function page(frame: Frame, cursor: string): { blobs: Uint8Array[]; next: string; signatures: Set<string> } {
  if (!Array.isArray(frame.events) || typeof frame.next_cursor !== 'string' || !/^[1-9][0-9]*$/.test(frame.next_cursor)) throw new Error('invalid Comb page')
  let expected = BigInt(cursor)
  const signatures = new Set<string>()
  const blobs = frame.events.map((event: unknown) => {
    const e = event as Frame
    if (!e || e.seq !== String(expected++) || typeof e.payload_hex !== 'string' || !/^(?:[a-fA-F0-9]{2})+$/.test(e.payload_hex)) throw new Error('invalid Comb event or cursor gap')
    const bytes = Buffer.from(e.payload_hex, 'hex'); const decoded=decodeBlob(bytes); if(e.writerSignatureVerified === true)signatures.add(decoded.envelope.hash); return bytes
  })
  if (String(expected) !== frame.next_cursor) throw new Error('invalid Comb next cursor')
  return { blobs, next: frame.next_cursor, signatures }
}
export async function serveSync(config: CombConfig, signal: AbortSignal, log: (text: string) => void): Promise<void> {
  mkdirSync(replicaRoot(), { recursive: true })
  const release = acquireDocumentLock(join(replicaRoot(), 'daemon'), 100)
  try { initializeActivityJournal(message=>log(message)) } catch (error) { log(`activity journal: ${String(error)}`) }
  const catalogueFollower = followLocalCatalogues(config, signal, log)
  const materializeJobs = processMaterializeJobs(signal, log)
  const ownerNodeId = config.node?.id ?? process.env.FOUNDATION_NODE_ID ?? ''
  const observe = (design: LiveDesign, chain: FdnChain, hashes: string[], delivery: 'baseline'|'live', verified: boolean | ReadonlySet<string> = false, importedHashes?: ReadonlySet<string>): void => {
    try {
      const root=design.repoRoot??findShareRoot(dirname(design.file))
      const repo=root?readShareConfig(root)?.repo??null:null
      recordActivity(design,chain,hashes,{ownerNodeId,repo,delivery,importedHashes,...(typeof verified==='boolean'?{signatureVerified:verified}:{signatures:verified})})
    } catch (error) { log(`activity facts: ${String(error)}`) }
  }
  const pendingFacts = new Set<NodeJS.Timeout>()
  // Give a fresh ephemeral hint time to win dedup over its durable echo. Only
  // hints can produce live facts; a late outbox append always remains baseline.
  const baselineLater = (design: LiveDesign, chain: FdnChain, hashes: string[], verified: boolean | ReadonlySet<string>, importedHashes?: ReadonlySet<string>): void => {
    const timer=setTimeout(()=>{pendingFacts.delete(timer);observe(design,chain,hashes,'baseline',verified,importedHashes)},200)
    pendingFacts.add(timer)
  }
  const directReceived = new Map<string, Map<string, number>>()
  let direct: DirectChanges | undefined
  try { direct = config.direct ? new DirectChanges(config.direct, config.node?.id ?? '', change => {
    const copies = liveDesigns(log).filter(design => design.workspace === change.workspace && design.product === change.product && design.docId === change.docId)
    if (!copies.length) throw new Error('design is not live')
    const blobs = change.blobs.map(blob => Buffer.from(blob, 'hex'))
    for (const design of copies) {
      const received = directReceived.get(copyKey(design)) ?? new Map<string, number>()
      const fresh=new Set<string>()
      const importedChain=updateDocument(design.file, chain => {
      const known=new Set(chain.log().map(c=>c.hash));for(const blob of blobs){const hash=decodeBlob(blob).envelope.hash;if(!known.has(hash))fresh.add(hash)}
      if (chain.docId() !== change.docId) throw new Error('document identity mismatch')
      importChangeBlobs(chain, blobs)
      return chain
    }, true)
      observe(design,importedChain,blobs.map(b=>decodeBlob(b).envelope.hash),'baseline',false,fresh)
      for (const blob of blobs) { const hash = decodeBlob(blob).envelope.hash; if (!received.has(hash)) received.set(hash, Date.now() + 5000 + Math.floor(Math.random() * 5000)) }
      directReceived.set(copyKey(design), received)
    }
  }) : undefined
    await direct?.start()
    writeDirectStatus(direct ? 'enabled' : 'disabled', direct ? null : 'not configured')
  } catch (error) { log(`direct sync unavailable: ${String(error)}`); direct = undefined; writeDirectStatus('disabled', String(error)) }
  const catalogueQueue = new CatalogueQueue(config, signal, log)
  let keyMaintenance:Promise<void>|undefined
  const maintain=():void=>{if(!config.binary&&!keyMaintenance)keyMaintenance=maintainKnownRepos().catch(error=>log(`sharing: ${String(error)}`)).finally(()=>{keyMaintenance=undefined})}
  const keyTimer=setInterval(maintain,2000);maintain()
  const workers = new Map<string, { controller: AbortController; done: Promise<void>; registration: string }>()
  async function run(design: LiveDesign, signal: AbortSignal): Promise<void> {
    const transport = configForDesign(config, design)
    updateDocument(design.file, chain => {
      if (chain.docId() !== design.docId) throw new Error('live path now holds another design')
      chain.upgradeStorage()
    }, true)
    const baseline = loadChain(readFileSync(`${design.file}.chain`))
    if (baseline.verify().ok) observe(design,baseline,baseline.changes().map(c=>c.envelope.hash),'baseline')
    let receivingLive = false
    const importedHashes = new Set<string>()
    const key = copyKey(design), state = readSyncState(key), feed = combLog(design)
    let bridge: Bridge | undefined, watcher: FSWatcher | undefined, wake: (() => void) | undefined
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
    const assets = transport.share ? new AssetSharing(transport,design.file,design.repoRoot ?? findShareRoot(dirname(design.file)) ?? dirname(design.file)) : undefined
    const shareHints=transport.share&&process.env.FOUNDATION_SHARE_HINTS!=='0'?new ShareHints(transport,feed):undefined
    const hinted = new Set<string>(transport.share?baseline.changes().map(c=>c.envelope.hash):[])
    const freshFacts=new Map<string,number>()
    let hintSignature = '', directPoll: NodeJS.Timeout | undefined
    const pushDirect = (): void => {
      if ((!direct&&!shareHints) || signal.aborted) return
      try {
        const stat = statSync(`${design.file}.chain`), signature = `${stat.ino}:${stat.size}:${stat.mtimeMs}`
        if (signature === hintSignature) return
        const chain = loadChain(readFileSync(`${design.file}.chain`))
        if (chain.docId() !== design.docId) return
        if (shareHints && assets && !assets.hintsReady(chain)) return
        const published = new Set(state.published), received = directReceived.get(key)
        const changes = chain.changes().filter(change => !published.has(change.envelope.hash) && !hinted.has(change.envelope.hash) && !received?.has(change.envelope.hash))
        const batch: { hash: string; hex: string }[] = []; let bytes = 0
        for (const change of changes) {
          const blob = encodeBlob(change.envelope, change.bytes)
          if (blob.length > (shareHints?350000:491520)) { hinted.add(change.envelope.hash); continue }
          if (batch.length === 16 || bytes + blob.length > 500000) break
          batch.push({ hash: change.envelope.hash, hex: Buffer.from(blob).toString('hex') }); bytes += blob.length
        }
        if (batch.length) {
          syncTrace('direct.notice', () => ({ docId: design.docId, hashes: batch.map(change => change.hash) }))
          direct?.push({ workspace: design.workspace, product: design.product, docId: design.docId, blobs: batch.map(change => change.hex) })
          const accepted=shareHints?shareHints.push(batch):batch.map(c=>c.hash)
          for (const hash of accepted) {hinted.add(hash);freshFacts.set(hash,Date.now()+4000)}
          for(const [hash,until]of freshFacts)if(until<Date.now())freshFacts.delete(hash)
        }
        if (batch.length === changes.length&&batch.every(c=>hinted.has(c.hash))) hintSignature = signature
      } catch { /* Atomic replacement or an unavailable optional peer never blocks Comb. */ }
    }
    const relayController = new AbortController()
    const relay = transport.share&&process.env.FOUNDATION_SHARE_RELAY!=='0' ? shareRelay(transport.share, transport.shareLog??feed, AbortSignal.any([signal,relayController.signal]), async (bytes,signatureVerified,source) => {
      if (assets) { const candidate=loadChain(readFileSync(design.file+'.chain'));importChangeBlobs(candidate,[bytes]);await assets.receive(candidate) }
      let imported=0
      const importedChain=updateDocument(design.file, chain => { if(chain.docId()!==design.docId)throw new Error('document identity mismatch');const hash=decodeBlob(bytes).envelope.hash;const present=chain.log().some(c=>c.hash===hash);imported=importChangeBlobs(chain,[bytes]);if(!present)importedHashes.add(hash);return chain },true)
      const factHash=decodeBlob(bytes).envelope.hash
      if(imported)freshFacts.set(factHash,Date.now()+220)
      if(source==='hint'&&(imported||(freshFacts.get(factHash)??0)>Date.now()))observe(design,importedChain,[factHash],receivingLive?'live':'baseline',signatureVerified,importedHashes)
      else baselineLater(design,importedChain,[decodeBlob(bytes).envelope.hash],signatureVerified,importedHashes)
      if(!imported)return
      const received=directReceived.get(key)??new Map<string,number>(); const hash=decodeBlob(bytes).envelope.hash
      if(!received.has(hash))received.set(hash,Date.now()+5000);directReceived.set(key,received);wake?.()
    }) : undefined
    const stop = (): void => { bridge?.close(); wake?.() }
    signal.addEventListener('abort', stop)
    try {
      try { watcher = watch(dirname(design.file), (_event, name) => { if (name === null || design.file.endsWith(`/${name}`) || `${design.file}.chain`.endsWith(`/${name}`)) { syncTrace('daemon.notice', () => ({ docId: design.docId, chain: name === null || String(name).endsWith('.chain') })); pushDirect(); wake?.() } }); watcher.on('error', () => watcher?.close()) } catch { /* Poll remains active on unsupported filesystems. */ }
      if (direct||shareHints) { directPoll = setInterval(pushDirect, 250); pushDirect() }
      while (!signal.aborted) {
        let receiveError: unknown, publishingHash: string | undefined
        try {
          receivingLive = false
          bridge = createBridge(transport); await bridge.hello()
          const active = bridge
          let failed: unknown
          const follow = (async () => {
            while (!signal.aborted) {
              const response = await active.request('read', { log: feed, cursor: state.cursor, max_events: 128, max_bytes: 491520 })
              if (response.log !== feed) throw new Error('Comb response feed mismatch')
              const decode = syncTraceSpan('receive.page', () => ({ docId: design.docId, cursor: state.cursor }))
              const incoming = page(response, state.cursor); decode({ count: incoming.blobs.length })
              if (incoming.blobs.length) {
                if (assets) {const candidate=loadChain(readFileSync(design.file+'.chain'));importChangeBlobs(candidate,incoming.blobs);await assets.receive(candidate)}
                const done = syncTraceSpan('receive.locked-import', () => ({ docId: design.docId, cursor: state.cursor, hashes: incoming.blobs.map(blob => decodeBlob(blob).envelope.hash) }))
                let imported = 0, ok = false, importedChain: FdnChain | undefined
                const freshHashes:string[]=[]
                try { importedChain=updateDocument(design.file, chain => {
                  if (chain.docId() !== design.docId) throw new Error('live path now holds another design')
                  const previousHashes=new Set(chain.log().map(c=>c.hash))
                  imported = importChangeBlobs(chain, incoming.blobs, syncTraceEnabled ? (stage, durationMs) => syncTrace(`receive.${stage}`, () => ({ docId: design.docId, durationMs })) : undefined)
                  for(const blob of incoming.blobs){const hash=decodeBlob(blob).envelope.hash;if(!previousHashes.has(hash)){importedHashes.add(hash);freshHashes.push(hash)}}
                  return chain
                }, true); ok = true } finally { done({ imported, ok }) }
                for(const hash of freshHashes)freshFacts.set(hash,Date.now()+220)
                if(importedChain)baselineLater(design,importedChain,incoming.blobs.map(blob=>decodeBlob(blob).envelope.hash),transport.share?incoming.signatures:false,importedHashes)
                // Delivery itself proves durable sharing, even when the append acknowledgement was lost.
                const shared = new Set(state.published)
                for (const blob of incoming.blobs) shared.add(decodeBlob(blob).envelope.hash)
                state.published = [...shared]
                state.cursor = incoming.next; state.updatedAt = new Date().toISOString(); writeSyncState(key, state)
              }
              succeeded('receive')
              if (!incoming.blobs.length) { receivingLive=true;await delay(250) }
            }
          })().catch(err => { receivingLive=false;failed = err; receiveError = err; active.close(); wake?.() })
          try {
            while (!signal.aborted && !failed) {
              const chain = loadChain(readFileSync(`${design.file}.chain`))
              if (chain.docId() !== design.docId) throw new Error('live path now holds another design')
              const published = new Set(state.published)
              const receivedHistory = directReceived.get(key)
              for (const hash of published) { hinted.delete(hash); receivedHistory?.delete(hash) }
              const unshared = chain.changes().filter(c => !published.has(c.envelope.hash))
              if (state.pending !== unshared.length) { state.pending = unshared.length; writeSyncState(key, state) }
              // Let the originating node finish its append; recover durability if it disappears.
              const received = directReceived.get(key)
              // changes() is in Lamport order: never publish a descendant past a held parent.
              const pending = publishablePrefix(unshared, received)
              if (pending.length) {
                await assets?.publish(chain)
                syncTrace('publish.pending', () => ({ docId: design.docId, hashes: pending.map(change => change.envelope.hash) }))
                // A persistent bridge renews exclusive feed ownership. Bound each writer
                // batch and send clean EOF, so other nodes can publish through the same log.
                publishingHash = pending[0]!.envelope.hash
                const writer = createBridge(transport)
                try {
                  await writer.hello()
                  for (const change of pending.slice(0, 16)) {
                    if (signal.aborted) break
                    publishingHash = change.envelope.hash
                    const bytes = encodeBlob(change.envelope, change.bytes)
                    if (bytes.length > 491520) throw new Error(`change ${change.envelope.hash} exceeds Comb append limit (491520 bytes)`)
                    const receipt = await writer.request('append', { log: feed, idempotency_key: change.envelope.hash, payload_hex: Buffer.from(bytes).toString('hex') })
                    validateAppendReceipt(receipt, feed)
                    baselineLater(design,chain,[change.envelope.hash],!!transport.share,importedHashes)
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
          await delay(Math.round(retry[side] * (0.5 + Math.random() / 2))); retry[side] = Math.min(retry[side] * 2, 5000)
        }
      }
    } finally { relayController.abort();await relay;await shareHints?.close(); if (directPoll) clearInterval(directPoll); watcher?.close(); signal.removeEventListener('abort', stop) }
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
          const controller = new AbortController(), workerSignal = AbortSignal.any([signal, controller.signal])
          const done = (async () => {
            let backoff = 250
            while (!workerSignal.aborted) {
              try { await run(design, workerSignal); return }
              catch (err) {
                if (workerSignal.aborted) return
                const message = `startup: ${err instanceof Error ? err.message : String(err)}`
                try {
                  const state = readSyncState(key)
                  state.connectionError = message
                  state.lastError = [state.receiveError, state.publishError, state.connectionError].filter(Boolean).join('; ')
                  state.lastErrorAt = new Date().toISOString()
                  writeSyncState(key, state)
                } catch { /* Status reads surface corrupt/unreadable state; never replace its cursor with defaults. */ }
                log(`${feedName(design)}: ${message}`)
                await delay(Math.round(backoff * (0.5 + Math.random() / 2)))
                backoff = Math.min(backoff * 2, 5000)
              }
            }
          })()
          workers.set(key, { controller, done, registration: JSON.stringify(design) })
        }
      }
      await delay(250)
    }
    await Promise.all([...workers.values()].map(worker => worker.done))
    await catalogueQueue.close()
  } finally { clearInterval(keyTimer);await keyMaintenance;await catalogueFollower;await materializeJobs;for(const timer of pendingFacts)clearTimeout(timer);try{closeActivityJournal()}catch(error){log(`activity shutdown: ${String(error)}`)};await direct?.close(); writeDirectStatus('disabled', 'daemon stopped'); release() }
}
