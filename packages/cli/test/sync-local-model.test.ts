import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createChain } from 'foundation-engine'
import { skeletonDocument } from '../src/commands/new.js'
import type { CatalogueRecord } from '../src/sync/catalogue.js'
import { activityBatch, catalogueCachePath, catalogueSnapshot, foldCatalogue, initializeActivityJournal, newCatalogueCache, persistModel, readCatalogueCache, recordActivity } from '../src/sync/local-model.js'

let root: string
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); if (root) rmSync(root, { recursive: true, force: true }) })
function setup() { root = mkdtempSync(join(tmpdir(), 'sync-local-model-')); vi.stubEnv('FOUNDATION_REPLICA_STORE', join(root, 'store')) }
const record = (node = 'metal-3', generation = 1, deleted = false): CatalogueRecord => ({ version: 1, workspaceId: 'w', productId: 'p', docId: 'doc', repoRelativePath: 'design/board.fdn.html', title: 'Private draft', originNode: { id: node, name: node }, replicaId: 'replica', generation, headHash: 'a'.repeat(64), lastAuthor: 'author', lastWallTime: null, lastAgentEdit: null, deleted })

it('folds by replica, retains tombstones and quarantines regressions and bad paths without deleting valid rows', () => {
  const cache = newCatalogueCache('sp_test', 'github.com/team/repo', '/repo')
  foldCatalogue(cache, record()); foldCatalogue(cache, record())
  expect(cache.records).toHaveLength(1)
  foldCatalogue(cache, record('Studio')); foldCatalogue(cache, record('metal-3', 2, true))
  foldCatalogue(cache, record('metal-3', 1)); foldCatalogue(cache, { ...record(), repoRelativePath: '../escape.fdn.html' })
  foldCatalogue(cache, { ...record(), version: 99 }); foldCatalogue(cache, { ...record('Studio'), title: 'conflicting generation' })
  expect(cache.records).toHaveLength(2)
  expect(cache.records.find(r => r.originNode.id === 'metal-3')).toMatchObject({ generation: 2, deleted: true })
  expect(cache.records.find(r => r.originNode.id === 'Studio')).toMatchObject({ generation: 1, deleted: false, title: 'Private draft' })
  expect(cache.errors).toHaveLength(3)
})

it('returns persisted last-known rows offline without a network or checkout scan and keeps the revision stable on contact only', () => {
  setup()
  const cache = newCatalogueCache('sp_test', 'github.com/team/repo', '/does-not-exist')
  foldCatalogue(cache, record()); cache.lastContactAt = Date.now()
  persistModel(catalogueCachePath(cache.space), cache)
  const fetcher = vi.fn(() => { throw new Error('network forbidden in cached read') }); vi.stubGlobal('fetch', fetcher)
  const before = catalogueSnapshot('w')
  cache.lastContactAt += 1; persistModel(catalogueCachePath(cache.space), cache)
  expect(catalogueSnapshot('w').revision).toBe(before.revision)
  cache.error = 'service unavailable'; persistModel(catalogueCachePath(cache.space), cache)
  const offline = catalogueSnapshot('w')
  expect(offline.records).toEqual(before.records); expect(offline.freshness.state).toBe('stale')
  expect(fetcher).not.toHaveBeenCalled()
  expect(readCatalogueCache(cache.space, cache.repo, '/new-root').repoRoot).toBe('/new-root')
  expect(catalogueSnapshot('other').records).toEqual([])
})

it('persists cross-copy hash dedup and resumes validated facts without upgrading unsigned origin claims', () => {
  setup(); initializeActivityJournal()
  const chain = createChain(skeletonDocument('Board'), { author: 'seed', message: 'init', originNode: 'untrusted' }, { docId: 'doc' })
  const design = { docId: 'doc', workspace: 'w', product: 'p', file: join(root, 'board.fdn.html') }
  const options = { ownerNodeId: 'Studio', repo: 'github.com/team/repo', delivery: 'baseline' as const }
  recordActivity(design, chain, [chain.head().hash], options)
  const baseline = activityBatch(undefined, 'w')
  expect(baseline.events).toHaveLength(1)
  expect(baseline.events[0]!.source).toBe('local')
  expect(baseline.events[0]).toMatchObject({ delivery: 'baseline', originNode: null, originAssurance: null, signatureVerified: false, entry: { originNode: null, boardKeys: [] } })
  const bytes = readFileSync(join(root, 'store/read-model/activity.json'))
  recordActivity({ ...design, file: '/another-copy' }, chain, [chain.head().hash], { ...options, delivery: 'live', signatureVerified: true })
  expect(readFileSync(join(root, 'store/read-model/activity.json'))).toEqual(bytes)
  chain.apply({ author: 'agent:writer', message: 'edit', originNode: 'metal-3', wallTime: new Date().toISOString() }, [{ op: 'set-text', id: 'n1', text: 'Changed' }])
  recordActivity(design, chain, [chain.head().hash], { ...options, delivery: 'live', signatureVerified: true, source: 'import' })
  const resumed = activityBatch(baseline.cursor, 'w')
  expect(resumed.events).toHaveLength(1)
  expect(resumed.events[0]).toMatchObject({ source: 'import', document: { ownerNodeId: 'Studio' }, originNode: { id: 'metal-3' }, originAssurance: 'writer-stated', signatureVerified: true, entry: { nodes: { changed: ['n1'] }, nodeIds: ['n1'], factsComplete: true } })
  expect(activityBatch(resumed.cursor, 'w').events).toEqual([])
  expect(() => activityBatch('sync-activity1:foreign:0')).toThrow('stale activity cursor')
})
