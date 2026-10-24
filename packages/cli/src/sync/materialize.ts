import { mkdirSync, realpathSync, statSync, existsSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { CatalogueRecord } from './catalogue.js'
import { catalogueLog } from './catalogue.js'
import { CombBridge } from './bridge.js'
import { combLog, type CombConfig } from './daemon.js'
import { restoreChangeBlobs } from '../../../engine/src/chain/blob.js'
import { materializeDocument } from '../disk.js'
import { registerDesign } from '../sync-store.js'

export class MaterializeError extends Error {
  constructor(public code: 'path-conflict' | 'product-unavailable' | 'history-unavailable' | 'deleted-source' | 'invalid-history' | 'invalid-path', message: string) { super(message) }
}
export interface MaterializeRequest {
  workspaceId: string
  productId: string
  docId: string
  checkoutRoot: string
  targetPath?: string
  repoRelativePath?: string
  sourceReplica?: string
  expectedHead?: string
  requestKey?: string
}
export function materializePath(root: string, path: string): string {
  if (!path || path.includes('\\') || path.split('/').includes('..')) throw new MaterializeError('invalid-path', 'target must be a confined .fdn.html path')
  const target = resolve(root, path), rel = relative(root, target)
  if (!rel || isAbsolute(rel) || rel.split('/').includes('..') || !target.endsWith('.fdn.html')) throw new MaterializeError('invalid-path', 'target must stay inside the Product checkout')
  let ancestor = target
  while (!existsSync(ancestor)) ancestor = dirname(ancestor)
  const real = realpathSync(ancestor), confined = relative(root, real)
  if (isAbsolute(confined) || confined.split('/').includes('..')) throw new MaterializeError('invalid-path', 'target symlink escapes the Product checkout')
  return target
}
async function replay(bridge: CombBridge, log: string, consume: (bytes: Uint8Array) => void): Promise<void> {
  const head = await bridge.request('head', { log })
  if (head.log !== log || typeof head.cursor !== 'string' || !/^[1-9][0-9]*$/.test(head.cursor)) throw new MaterializeError('invalid-history', 'invalid feed head')
  const limit = BigInt(head.cursor)
  let cursor = 1n
  while (cursor < limit) {
    const count = Number(limit - cursor > 128n ? 128n : limit - cursor)
    const page = await bridge.request('read', { log, cursor: String(cursor), max_events: count, max_bytes: 491520 })
    if (page.log !== log || !Array.isArray(page.events) || page.events.length === 0 || page.events.length > count) throw new MaterializeError('history-unavailable', `missing feed history at ${cursor}`)
    for (const raw of page.events) {
      const event = raw as { seq?: unknown; payload_hex?: unknown }
      if (!event || event.seq !== String(cursor) || typeof event.payload_hex !== 'string' || !/^(?:[0-9a-fA-F]{2})+$/.test(event.payload_hex)) throw new MaterializeError('invalid-history', `invalid event at ${cursor}`)
      consume(Buffer.from(event.payload_hex, 'hex')); cursor++
    }
    if (page.next_cursor !== String(cursor)) throw new MaterializeError('invalid-history', 'invalid feed cursor')
  }
}
function catalogueEntry(bytes: Uint8Array, request: MaterializeRequest): CatalogueRecord | null {
  try {
    const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as CatalogueRecord
    if (record.version !== 1 || record.workspaceId !== request.workspaceId || record.productId !== request.productId || record.docId !== request.docId || typeof record.replicaId !== 'string' || typeof record.originNode?.id !== 'string' || !Number.isSafeInteger(record.generation) || record.generation < 1 || typeof record.repoRelativePath !== 'string' || typeof record.deleted !== 'boolean') return null
    if (isAbsolute(record.repoRelativePath) || record.repoRelativePath.includes('\\') || record.repoRelativePath.split('/').some(part => !part || part === '.' || part === '..') || !record.repoRelativePath.endsWith('.fdn.html')) return null
    return record
  } catch { return null }
}
export async function materialize(request: MaterializeRequest, config: CombConfig) {
  for (const part of [request.workspaceId, request.productId, request.docId]) if (!/^[A-Za-z0-9._-]+$/.test(part)) throw new MaterializeError('invalid-path', 'invalid design address')
  if (request.expectedHead && !/^[a-f0-9]{64}$/.test(request.expectedHead)) throw new MaterializeError('invalid-history', 'invalid expected head')
  let root: string
  try { root = realpathSync(request.checkoutRoot); if (!statSync(root).isDirectory()) throw new Error('not a directory') }
  catch { throw new MaterializeError('product-unavailable', 'Product checkout root does not exist; materialize never clones a repository') }
  const bridge = new CombBridge(config.binary, config.args)
  try {
    await bridge.hello()
    let target = request.targetPath ?? request.repoRelativePath
    if (!target || request.sourceReplica) {
      const replicas = new Map<string, CatalogueRecord>()
      await replay(bridge, catalogueLog(request.workspaceId), bytes => {
        const record = catalogueEntry(bytes, request)
        if (!record || (request.sourceReplica && record.replicaId !== request.sourceReplica)) return
        const key = `${record.originNode.id}/${record.replicaId}`, previous = replicas.get(key)
        if (!previous || record.generation > previous.generation) replicas.set(key, record)
      })
      const candidates = [...replicas.values()].sort((a, b) => a.originNode.id.localeCompare(b.originNode.id) || a.replicaId.localeCompare(b.replicaId))
      const selected = candidates.find(record => !record.deleted)
      if (!selected) throw new MaterializeError(candidates.length ? 'deleted-source' : 'history-unavailable', 'no advertised live source replica; supply an explicit target if catalogue metadata is unavailable')
      target ??= selected.repoRelativePath
    }
    const file = materializePath(root, target!)
    const blobs: Uint8Array[] = []
    await replay(bridge, combLog({ workspace: request.workspaceId, product: request.productId, docId: request.docId, file }), bytes => blobs.push(bytes))
    if (!blobs.length) throw new MaterializeError('history-unavailable', 'design feed is empty or unavailable')
    let chain
    try { chain = restoreChangeBlobs(blobs, request.docId) }
    catch (err) { throw new MaterializeError('invalid-history', String(err)) }
    if (request.expectedHead && !chain.changes().some(change => change.envelope.hash === request.expectedHead)) throw new MaterializeError('history-unavailable', 'expected head is absent from retained history')
    // No document writes occur until the complete remote candidate passes verification.
    mkdirSync(dirname(file), { recursive: true }); materializePath(root, file)
    try { chain = materializeDocument(file, chain) }
    catch (err) {
      if (String(err).includes('path-conflict:')) throw new MaterializeError('path-conflict', String(err))
      throw err
    }
    registerDesign(file, request.workspaceId, request.productId, root)
    return { state: 'ready' as const, workspaceId: request.workspaceId, productId: request.productId, docId: request.docId, path: file, repoPath: root, headHash: chain.head().hash, requestKey: request.requestKey ?? null }
  } catch (err) {
    if (err instanceof MaterializeError) throw err
    throw new MaterializeError('history-unavailable', String(err))
  } finally { bridge.close() }
}
