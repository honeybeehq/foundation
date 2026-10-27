import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { ChainLogEntry, FdnChain } from 'foundation-engine'
import { replicaRoot, type LiveDesign } from '../sync-store.js'
import type { CatalogueRecord, NodeRef } from './catalogue.js'

export interface DesignRef { workspaceId: string; productId: string; docId: string }
export interface LocalReplica extends DesignRef { path: string; repoPath: string; headHash: string }
export interface CatalogueCache {
  version: 1; space: string; repo: string; repoRoot: string; cursor: string
  records: CatalogueRecord[]; localReplicas: LocalReplica[]
  lastContactAt: number | null; error: string | null; errors: string[]
}
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function modelRoot(): string { return join(replicaRoot(), 'read-model') }
/** Local decrypted metadata is private; fsync before publishing a new cursor or dedup set. */
export function persistModel(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
  const file = openSync(temp, 'wx', 0o600)
  try { writeFileSync(file, JSON.stringify(value)); fsyncSync(file) } finally { closeSync(file) }
  renameSync(temp, path)
  const directory = openSync(dirname(path), 'r')
  try { fsyncSync(directory) } finally { closeSync(directory) }
}
export function catalogueCachePath(space: string): string { return join(modelRoot(), 'catalogues', `${digest(space)}.json`) }
export interface CatalogueContact { following: boolean; lastContactAt: number | null; error: string | null }
export function catalogueContactPath(space: string): string { return join(modelRoot(), 'catalogue-contact', `${digest(space)}.json`) }
/** Contact is rebuildable telemetry, not a durable feed cursor or document acknowledgement. */
export function recordCatalogueContact(space: string, contact: CatalogueContact): void {
  const path=catalogueContactPath(space), temp=`${path}.${process.pid}.tmp`
  mkdirSync(dirname(path),{recursive:true,mode:0o700})
  writeFileSync(temp,JSON.stringify(contact),{mode:0o600});renameSync(temp,path)
}
export function newCatalogueCache(space: string, repo: string, repoRoot: string): CatalogueCache {
  return { version: 1, space, repo, repoRoot, cursor: '1', records: [], localReplicas: [], lastContactAt: null, error: null, errors: [] }
}
export function readCatalogueCache(space: string, repo: string, repoRoot: string): CatalogueCache {
  try {
    const cache = JSON.parse(readFileSync(catalogueCachePath(space), 'utf8')) as CatalogueCache
    if (cache.version !== 1 || cache.space !== space || cache.repo !== repo || !/^[1-9][0-9]*$/.test(cache.cursor) || !Array.isArray(cache.records) || !Array.isArray(cache.localReplicas) || !Array.isArray(cache.errors)) throw new Error('invalid local catalogue checkpoint')
    cache.repoRoot = repoRoot
    return cache
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return newCatalogueCache(space, repo, repoRoot)
  }
}
const address = (r: DesignRef): string => JSON.stringify([r.workspaceId, r.productId, r.docId])
const replicaKey = (r: CatalogueRecord): string => JSON.stringify([r.workspaceId, r.productId, r.docId, r.originNode.id, r.replicaId])
function validRecord(value: unknown): CatalogueRecord {
  const r = value as CatalogueRecord
  if (!r || r.version !== 1 || ![r.workspaceId, r.productId, r.docId].every(v => typeof v === 'string' && /^[A-Za-z0-9._-]+$/.test(v)) || typeof r.replicaId !== 'string' || !r.replicaId || r.replicaId.length > 256 || !r.originNode || typeof r.originNode.id !== 'string' || !r.originNode.id || r.originNode.id.length > 256 || typeof r.originNode.name !== 'string' || r.originNode.name.length > 4096 || !Number.isSafeInteger(r.generation) || r.generation < 1 || typeof r.repoRelativePath !== 'string' || isAbsolute(r.repoRelativePath) || r.repoRelativePath.includes('\\') || r.repoRelativePath.length > 4096 || /[\u0000-\u001f\u007f]/.test(r.repoRelativePath) || r.repoRelativePath.split('/').some(p => !p || p === '.' || p === '..' || p === '.git') || !r.repoRelativePath.endsWith('.fdn.html') || typeof r.title !== 'string' || r.title.length > 4096 || !/^[a-f0-9]{64}$/.test(r.headHash) || typeof r.deleted !== 'boolean' || !(r.lastAuthor === null || typeof r.lastAuthor === 'string') || !(r.lastWallTime === null || (typeof r.lastWallTime === 'number' && Number.isFinite(r.lastWallTime)))) throw new Error('unsupported or invalid catalogue record/path')
  // A catalogue claim alone cannot authenticate a Hive agent session.
  return { version: 1, workspaceId: r.workspaceId, productId: r.productId, docId: r.docId, repoRelativePath: r.repoRelativePath, title: r.title, originNode: { id: r.originNode.id, name: r.originNode.name }, replicaId: r.replicaId, generation: r.generation, headHash: r.headHash, lastAuthor: r.lastAuthor, lastWallTime: r.lastWallTime, lastAgentEdit: null, deleted: r.deleted }
}
/** Fold per replica. Tombstones never erase another machine's replica. */
export function foldCatalogue(cache: CatalogueCache, value: unknown): void {
  try {
    const record = validRecord(value), key = replicaKey(record)
    const index = cache.records.findIndex(r => replicaKey(r) === key), old = cache.records[index]
    if (old && record.generation < old.generation) throw new Error('regressing catalogue generation quarantined')
    if (old && record.generation === old.generation) {
      if (digest(record) !== digest(old)) throw new Error('conflicting catalogue generation quarantined')
      return
    }
    if (index < 0) {
      if (cache.records.length >= 10000) throw new Error('catalogue record limit reached')
      cache.records.push(record)
    } else cache.records[index] = record
    cache.records.sort((a, b) => replicaKey(a).localeCompare(replicaKey(b)))
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid catalogue record'
    cache.errors = [...new Set([...cache.errors, reason])].slice(-20)
  }
}
/** Cache files only: never read vaults, contact the service or scan a checkout here. */
export function catalogueSnapshot(workspace?: string, repoRoot?: string) {
  const caches: CatalogueCache[] = [], errors: string[] = []
  try {
    for (const file of readdirSync(join(modelRoot(), 'catalogues')).filter(f => /^[a-f0-9]{64}\.json$/.test(f))) {
      try {
        const value = JSON.parse(readFileSync(join(modelRoot(), 'catalogues', file), 'utf8')) as CatalogueCache
        if (value.version !== 1 || !Array.isArray(value.records) || !Array.isArray(value.localReplicas) || !Array.isArray(value.errors)) throw new Error('invalid local catalogue cache')
        if (!repoRoot || resolve(value.repoRoot) === resolve(repoRoot)) caches.push(value)
      } catch { errors.push('unreadable local catalogue cache; daemon must rebuild it') }
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const records = caches.flatMap(c => c.records).filter(r => !workspace || r.workspaceId === workspace)
  const localReplicas = caches.flatMap(c => c.localReplicas).filter(r => !workspace || r.workspaceId === workspace)
  const contacts=caches.map(cache=>{
    try { const value=JSON.parse(readFileSync(catalogueContactPath(cache.space),'utf8')) as CatalogueContact
      if(typeof value.following!=='boolean'||!(value.lastContactAt===null||typeof value.lastContactAt==='number')||!(value.error===null||typeof value.error==='string'))throw new Error('invalid contact')
      return value
    }catch{return {following:true,lastContactAt:cache.lastContactAt,error:cache.error}}
  })
  const active=contacts.filter(c=>c.following)
  const lastContactAt = (active.length ? Math.min(...active.map(c => c.lastContactAt ?? 0)) : Math.max(0,...contacts.map(c=>c.lastContactAt??0))) || null
  const connectionErrors=[...errors,...active.flatMap(c=>c.error?[c.error]:[])]
  const diagnostics=[...connectionErrors,...caches.flatMap(c=>c.errors)].slice(-20)
  const stale = !!connectionErrors.length || (caches.length>0&&!active.length) || (lastContactAt !== null && Date.now() - lastContactAt > 5000)
  const reason=connectionErrors[0]??(!active.length&&caches.length?'local catalogue followers are stopped':stale?'local sync follower has not contacted the service recently':null)
  const freshness = { state: stale ? 'stale' as const : !lastContactAt ? 'starting' as const : 'fresh' as const, lastContactAt, reason }
  return { version: 1 as const, records, localReplicas, revision: digest([records, localReplicas, freshness.state, diagnostics]), freshness, errors: diagnostics }
}

export interface ImportedFact {
  version: 1; cursor: string; document: DesignRef & { ownerNodeId: string }; repo: string | null
  originNode: NodeRef | null; originAssurance: 'writer-stated' | null; signatureVerified: boolean
  source: 'local' | 'import'; entry: ChainLogEntry & { boardKeys: string[] }; delivery: 'baseline' | 'live'; observedAt: number
}
export { initializeActivityJournal, recordActivity, activityBatch, flushActivityJournal, closeActivityJournal } from './activity-journal.js'
