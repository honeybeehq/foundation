import { readFileSync, statSync } from 'node:fs'
import { loadChain } from 'foundation-engine'
import { liveDesigns } from '../sync-store.js'
import { readVault } from '../share/vault.js'
import { findShareRoot, readShareConfig, type ShareConfig } from '../share/config.js'
import { createBridge } from '../share/transport.js'
import { dirname } from 'node:path'
import { catalogueLog } from './catalogue.js'
import { catalogueCachePath, foldCatalogue, persistModel, readCatalogueCache, recordCatalogueContact } from './local-model.js'
import type { CombConfig } from './daemon.js'

const wait = async (signal: AbortSignal): Promise<void> => {
  if (signal.aborted) return
  await new Promise<void>(done => {
    const finish = (): void => { clearTimeout(timer); signal.removeEventListener('abort', finish); done() }
    const timer = setTimeout(finish, 1000); signal.addEventListener('abort', finish, { once: true })
  })
}
async function follow(root: string, share: ShareConfig, signal: AbortSignal): Promise<void> {
  const cache = readCatalogueCache(share.space, share.repo, root)
  const log = catalogueLog('catalogue') // Share transport uses the repo-wide logical catalogue address.
  let reader = createBridge({ binary: '', args: [], share, shareLog: 'foundation-share-catalogue-v1' })
  let saved=''
  const localHeads=new Map<string,{signature:string;docId:string|null;headHash:string}>()
  const checkpoint = (): void => {
    const value=JSON.stringify([cache.cursor,cache.records,cache.localReplicas,cache.errors,cache.repoRoot])
    if(value===saved)return
    persistModel(catalogueCachePath(share.space),cache);saved=value
  }
  const contact=(following=true):void=>recordCatalogueContact(share.space,{following,lastContactAt:cache.lastContactAt,error:cache.error})
  try {
    checkpoint()
    while (!signal.aborted) {
        cache.localReplicas = liveDesigns().flatMap(design => {
          try {
            const repoRoot = design.repoRoot ?? findShareRoot(dirname(design.file))
            if (repoRoot !== root) return []
            const path=`${design.file}.chain`,stat=statSync(path),signature=JSON.stringify([stat.ino,stat.mtimeMs,stat.size])
            let head=localHeads.get(path)
            if(head?.signature!==signature){const chain=loadChain(readFileSync(path));head={signature,docId:chain.docId(),headHash:chain.head().hash};localHeads.set(path,head)}
            if (head.docId !== design.docId) return []
            return [{ workspaceId: design.workspace, productId: design.product, docId: design.docId, path: design.file, repoPath: root, headHash: head.headHash }]
          } catch { return [] }
        }).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
        const paths=new Set(cache.localReplicas.map(r=>r.path+'.chain'));for(const path of localHeads.keys())if(!paths.has(path))localHeads.delete(path)

      try {
        await reader.hello()
        const head = await reader.request('head', { log })
        if (head.log !== log || typeof head.cursor !== 'string' || !/^[1-9][0-9]*$/.test(head.cursor)) throw new Error('invalid catalogue feed head')
        if (BigInt(cache.cursor) > BigInt(head.cursor)) cache.cursor = '1' // Rebuild after lost history; never infer deletions.
        while (!signal.aborted && BigInt(cache.cursor) < BigInt(head.cursor)) {
          const count = Number(BigInt(head.cursor) - BigInt(cache.cursor) > 128n ? 128n : BigInt(head.cursor) - BigInt(cache.cursor))
          const page = await reader.request('read', { log, cursor: cache.cursor, max_events: count, max_bytes: 491520 })
          if (page.log !== log || !Array.isArray(page.events) || !page.events.length || page.events.length > count) throw new Error('invalid catalogue feed page')
          let cursor = BigInt(cache.cursor)
          for (const event of page.events as {seq?:unknown;payload_hex?:unknown}[]) {
            if (!event || event.seq !== String(cursor++) || typeof event.payload_hex !== 'string' || !/^(?:[a-f0-9]{2})+$/i.test(event.payload_hex)) throw new Error('catalogue cursor gap or malformed event')
            try { foldCatalogue(cache, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(event.payload_hex, 'hex')))) }
            catch { cache.errors = [...new Set([...cache.errors, 'invalid catalogue JSON quarantined'])].slice(-20) }
          }
          if (page.next_cursor !== String(cursor)) throw new Error('catalogue next cursor mismatch')
          cache.cursor = String(cursor); checkpoint()
        }
        cache.lastContactAt = Date.now(); cache.error = null; checkpoint();contact()
      } catch (error) {
        cache.error = error instanceof Error ? error.message : String(error); checkpoint();contact()
        reader.close(); reader = createBridge({ binary: '', args: [], share, shareLog: 'foundation-share-catalogue-v1' })
      }
      await wait(signal)
    }
  } finally {
    reader.close(); cache.error = 'local catalogue follower stopped'; contact(false)
  }
}
/** Network work belongs to daemon-owned per-repo workers, never the catalogue read command. */
export async function followLocalCatalogues(config: CombConfig, signal: AbortSignal, log: (message: string) => void): Promise<void> {
  if (config.binary) return // Explicit development transport keeps its original behaviour.
  const workers = new Map<string, { signature: string; stop: AbortController; done: Promise<void> }>()
  try {
    while (!signal.aborted) {
      const active = new Set<string>()
      try {
        for (const session of Object.values(readVault().sessions)) {
          if (!session.repoRoot) continue
          const share = readShareConfig(session.repoRoot)
          if (!share) continue
          const signature = JSON.stringify([session.repoRoot, share]), old = workers.get(share.space)
          active.add(share.space)
          if (old?.signature === signature) continue
          if (old) { old.stop.abort(); await old.done }
          const stop = new AbortController()
          const done = follow(session.repoRoot, share, AbortSignal.any([signal, stop.signal])).catch(error => log(`catalogue follower: ${String(error)}`))
          workers.set(share.space, { signature, stop, done })
          void done.then(() => { if (workers.get(share.space)?.done === done) workers.delete(share.space) })
        }
        for (const [space, worker] of workers) if (!active.has(space)) {
          worker.stop.abort(); await worker.done; workers.delete(space)
        }
      } catch (error) { log(`catalogue discovery: ${String(error)}`) }
      await wait(signal)
    }
  } finally { for (const worker of workers.values()) worker.stop.abort(); await Promise.all([...workers.values()].map(w => w.done)) }
}
