import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
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
  if (!r || r.version !== 1 || ![r.workspaceId, r.productId, r.docId].every(v => typeof v === 'string' && /^[A-Za-z0-9._-]+$/.test(v)) || typeof r.replicaId !== 'string' || !r.replicaId || r.replicaId.length > 256 || !r.originNode || typeof r.originNode.id !== 'string' || !r.originNode.id || r.originNode.id.length > 256 || typeof r.originNode.name !== 'string' || r.originNode.name.length > 4096 || !Number.isSafeInteger(r.generation) || r.generation < 1 || typeof r.repoRelativePath !== 'string' || isAbsolute(r.repoRelativePath) || r.repoRelativePath.includes('\\') || r.repoRelativePath.split('/').some(p => !p || p === '.' || p === '..') || !r.repoRelativePath.endsWith('.fdn.html') || typeof r.title !== 'string' || r.title.length > 4096 || !/^[a-f0-9]{64}$/.test(r.headHash) || typeof r.deleted !== 'boolean' || !(r.lastAuthor === null || typeof r.lastAuthor === 'string') || !(r.lastWallTime === null || (typeof r.lastWallTime === 'number' && Number.isFinite(r.lastWallTime)))) throw new Error('unsupported or invalid catalogue record/path')
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
  const lastContactAt = caches.length ? Math.min(...caches.map(c => c.lastContactAt ?? 0)) || null : null
  const reasons = [...errors, ...caches.flatMap(c => [c.error, ...c.errors].filter((e): e is string => !!e))].slice(-20)
  const stale = !!reasons.length || (lastContactAt !== null && Date.now() - lastContactAt > 5000)
  const freshness = { state: stale ? 'stale' as const : !lastContactAt ? 'starting' as const : 'fresh' as const, lastContactAt, reason: reasons[0] ?? (stale ? 'local sync follower has not contacted the service recently' : null) }
  return { version: 1 as const, records, localReplicas, revision: digest([records, localReplicas, freshness.state, reasons]), freshness, errors: reasons }
}

export interface ImportedFact {
  version: 1; cursor: string; document: DesignRef & { ownerNodeId: string }; repo: string | null
  originNode: NodeRef | null; originAssurance: 'writer-stated' | null; signatureVerified: boolean
  entry: ChainLogEntry & { boardKeys: string[] }; delivery: 'baseline' | 'live'; observedAt: number
}
interface Journal { version: 1; id: string; next: number; seen: Record<string, string[]>; events: ImportedFact[] }
function journalPath(): string { return join(modelRoot(), 'activity.json') }
function journal(): Journal {
  try {
    const value = JSON.parse(readFileSync(journalPath(), 'utf8')) as Journal
    if (value.version !== 1 || typeof value.id !== 'string' || !Number.isSafeInteger(value.next) || value.next < 1 || !Array.isArray(value.events) || !value.seen || typeof value.seen !== 'object') throw new Error('invalid local activity journal; establish a new baseline')
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return { version: 1, id: randomUUID(), next: 1, seen: {}, events: [] }
  }
}
export function initializeActivityJournal(): void {
  const state=journal();persistModel(journalPath(),state)
}
const cursor = (state: Journal, seq: number): string => `sync-activity1:${state.id}:${seq}`
/** Called only with a successfully validated local chain, after import or publish. */
export function recordActivity(design: LiveDesign, chain: FdnChain, hashes: readonly string[], options: { ownerNodeId: string; repo: string | null; delivery: 'baseline' | 'live'; signatureVerified?: boolean }): void {
  if (!options.ownerNodeId || chain.docId() !== design.docId) return
  const document = { workspaceId: design.workspace, productId: design.product, docId: design.docId, ownerNodeId: options.ownerNodeId }
  const state = journal(), key = address(document), seen = new Set(state.seen[key] ?? [])
  const wanted = new Set(hashes.filter(hash => !seen.has(hash)))
  if (!wanted.size) return
  let before: string | undefined
  const entries: ChainLogEntry[] = []
  do {
    const page = chain.logPage({ limit: 200, ...(before ? { before } : {}) })
    for (const entry of page.entries) if (wanted.delete(entry.hash)) entries.push(entry)
    before = page.nextCursor ?? undefined
  } while (before && wanted.size)
  if (wanted.size) throw new Error('validated activity hashes absent from chain')
  for (const raw of entries.reverse()) {
    const verified = options.signatureVerified === true, origin = verified ? raw.originNode : null
    const entry = { ...raw, originNode: origin, boardKeys: (raw as ChainLogEntry & {boardKeys?:string[]}).boardKeys ?? [] }
    state.events.push({ version: 1, cursor: cursor(state, state.next++), document, repo: options.repo, originNode: origin ? { id: origin, name: origin } : null, originAssurance: origin ? 'writer-stated' : null, signatureVerified: verified, entry, delivery: options.delivery, observedAt: Date.now() })
    seen.add(raw.hash)
  }
  state.seen[key] = [...seen]
  state.events = state.events.slice(-10000)
  persistModel(journalPath(), state)
}
export function activityBatch(token?: string, workspace?: string): { events: ImportedFact[]; cursor: string } {
  // The daemon establishes the journal id; readers never create local state.
  readFileSync(journalPath())
  const state = journal()
  let after = 0
  if (token) {
    const prefix = `sync-activity1:${state.id}:`
    if (!token.startsWith(prefix) || !/^\d+$/.test(token.slice(prefix.length))) throw new Error('invalid or stale activity cursor; establish a new baseline')
    after = Number(token.slice(prefix.length))
    const oldest = state.events[0] ? Number(state.events[0].cursor.split(':').at(-1)) : state.next
    if (!Number.isSafeInteger(after) || after < oldest - 1 || after >= state.next) throw new Error('invalid or stale activity cursor; establish a new baseline')
  }
  const events = state.events.filter(e => Number(e.cursor.split(':').at(-1)) > after && (!workspace || e.document.workspaceId === workspace))
  return { events, cursor: cursor(state, state.next - 1) }
}
