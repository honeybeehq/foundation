/** Local storage recipe. The 10k cached fact bodies are labelled synthetic; new changes are real engine changes. */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { hostname, loadavg } from 'node:os'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createChain } from 'foundation-engine'
import { skeletonDocument } from '../src/commands/new.js'
import * as model from '../src/sync/local-model.js'
const root = mkdtempSync(resolve('.audit/journal-proof-'))
process.env.FOUNDATION_REPLICA_STORE = join(root, 'store')
const chain = createChain(skeletonDocument('Journal recipe'), { author: 'seed', message: 'seed' }, { docId: 'journal-proof' })
const entry = chain.logPage({ limit: 1 }).entries[0]!
const id = '11111111-1111-4111-8111-111111111111', address = JSON.stringify(['w', 'p', 'journal-proof'])
const hashes = Array.from({ length: 10000 }, (_, n) => (n + 1).toString(16).padStart(64, '0'))
const events = hashes.map((hash, n) => ({ version: 1, cursor: `sync-activity1:${id}:${n + 1}`, document: { workspaceId: 'w', productId: 'p', docId: 'journal-proof', ownerNodeId: 'local' }, repo: 'github.com/team/recipe', originNode: null, originAssurance: null, signatureVerified: false, source: 'local', entry: { ...entry, hash, boardKeys: [] }, delivery: 'baseline', observedAt: 1 }))
mkdirSync(join(root, 'store/read-model'), { recursive: true })
const legacy = JSON.stringify({ version: 1, id, next: 10001, seen: { [address]: hashes }, events })
writeFileSync(join(root, 'store/read-model/activity.json'), legacy)
model.initializeActivityJournal()
const flush = (model as typeof model & { flushActivityJournal?: () => void }).flushActivityJournal
const notices: number[] = [], flushes: number[] = []
for (let n = 0; n < 5; n++) {
  chain.apply({ author: 'writer', message: `new-${n}` }, [{ op: 'set-text', id: 'n1', text: String(n) }])
  const start = performance.now()
  model.recordActivity({ workspace: 'w', product: 'p', docId: 'journal-proof', file: join(root, 'board.fdn.html') }, chain, [chain.head().hash], { ownerNodeId: 'local', repo: 'github.com/team/recipe', delivery: 'live', source: 'local' })
  notices.push(performance.now() - start)
  const flushStart = performance.now(); flush?.(); flushes.push(performance.now() - flushStart)
  assert.ok(model.activityBatch(undefined, 'w').events.some(e => e.entry.hash === chain.head().hash))
}
// An old hash remains deduplicated even after it falls out of the retained fact tail.
const before = model.activityBatch().cursor
for (const delivery of ['live', 'baseline'] as const) model.recordActivity({ workspace: 'w', product: 'p', docId: 'journal-proof', file: join(root, 'other-copy.fdn.html') }, chain, [hashes[0]!], { ownerNodeId: 'local', repo: null, delivery })
flush?.()
assert.equal(model.activityBatch().cursor, before)
assert.ok(model.activityBatch().events.length <= 10000)
const receipt = { workload: 'local-activity-journal', seriesId: 'metal3-journal-10k-v1', commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), machine: hostname(), runtime: process.version, buildMode: 'source-tsx', loadavg: loadavg(), driverSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'), fixture: '10000 synthetic cached fact bodies; real new engine envelopes; no network or credentials', cachedBytes: Buffer.byteLength(legacy), queuedFlush: !!flush, results: [{ metric: 'journalNoticeMax', samples: notices, invariantHolds: true }], flushSamples: flushes }
writeFileSync(process.env.FOUNDATION_JOURNAL_RECEIPT ?? join(root, 'receipt.json'), JSON.stringify(receipt, null, 2))
console.log(JSON.stringify(receipt))
