// node --import tsx tests/envelope-identity-proof.mjs [--bench]
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { loadChain } from '../packages/engine/src/chain/chain.ts'
import { computeEnvelopeHash } from '../packages/engine/src/chain/envelope.ts'

const fixtures = JSON.parse(readFileSync(new URL('../packages/engine/test/fixtures/envelope-drift.json', import.meta.url), 'utf8'))
const a = loadChain(Buffer.from(fixtures.a, 'base64')), b = loadChain(Buffer.from(fixtures.b, 'base64'))
a.upgradeStorage(); b.upgradeStorage()
const original = a.changes().at(-1)
console.log(`Fixture original: ${original.envelope.hash} (${original.bytes.length} bytes)`)
b.importUpdate(original.bytes)

const meta = original.envelope
const span = [...a.loro.getAllChanges().values()].flat().sort((a,b) => a.lamport - b.lamport || (BigInt(a.peer) < BigInt(b.peer) ? -1 : 1)).at(-1)
const native = b.loro.export({ mode: 'updates-in-range', spans: [{ id: { peer: span.peer, counter: span.counter }, len: span.length }] })
console.log(`Native re-encoding (not identity): ${computeEnvelopeHash(meta.prevHash, meta.author, meta.message, meta.specVersion, native)}`)
assert.equal(original.envelope.hash, 'aa49bb9518cda8d14fa99829dd21225d7090aedee788df5537db7c348c393c69')
assert.equal(b.head().hash, original.envelope.hash)
assert.deepEqual(b.changes().at(-1).bytes, original.bytes)
const forwarded = loadChain(b.save())
assert.equal(forwarded.head().hash, original.envelope.hash)
a.merge(forwarded)
assert.deepEqual(a.save(), forwarded.save())
console.log(`After import, reload and forwarding: ${forwarded.head().hash}; exact original bytes retained`)
forwarded.apply({ author: 'proof:next', message: 'edit after fixture merge' }, [{ op: 'set-token', name: 'fixture-next', value: 'survives' }])
a.merge(forwarded)
assert.equal(a.head().hash, forwarded.head().hash)
assert.deepEqual(a.save(), forwarded.save())
assert.deepEqual(a.verify(), { ok: true })
console.log(`Next edit converges: ${a.head().hash}; verify OK; same-frontier save bytes identical`)

// Run the actual 49d3161 reader source against the v2 frame, without another checkout.
mkdirSync('.audit', { recursive: true })
const base = resolve('packages/engine/src/chain')
const legacySource = execFileSync('git', ['show', '49d3161:packages/engine/src/chain/chain.ts'], { encoding: 'utf8' })
  .replace(/from (['"])(\.[^'"]+)\1/g, (_match, quote, path) => `from ${quote}${resolve(base, path)}${quote}`)
const legacyPath = resolve('.audit/legacy-chain-49d3161.ts')
writeFileSync(legacyPath, legacySource)
const { loadChain: legacyLoad } = await import(pathToFileURL(legacyPath).href)
const legacyFixture = legacyLoad(Buffer.from(fixtures.a, 'base64'))
assert(legacyFixture.verify().ok)
const upgradedFixture = loadChain(loadChain(Buffer.from(fixtures.a, 'base64')).save({ format: 2 }))
assert(upgradedFixture.docId())
assert.deepEqual(upgradedFixture.log().map(change => change.hash), legacyFixture.log().map(change => change.hash))
console.log(`${legacyFixture.log().length} legacy hashes unchanged, including the docId genesis, after archive upgrade`)
let refused = false
try { legacyLoad(a.save()) } catch (error) { refused = true; console.log(`49d3161 reader refuses v2 before writes: ${String(error)}`) }
assert(refused, 'old reader must never silently drop the archive')

if (process.argv.includes('--bench')) {
  const large = loadChain(readFileSync('boards/tracks-pane.fdn.html.chain'), { actor: 'archive-cost' })
  for (let i = 0; i < 1000; i++) large.apply({ author: 'proof:cost', message: `edit ${i}` }, [{ op: 'set-token', name: 'archive-cost', value: String(i) }])
  const bytes = large.save({ format: 2 }), headerLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true)
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength)))
  const oldHeader = new TextEncoder().encode(JSON.stringify(header.anchors)), oldBytes = new Uint8Array(4 + oldHeader.length + bytes.length - 4 - headerLength)
  new DataView(oldBytes.buffer).setUint32(0, oldHeader.length, true); oldBytes.set(oldHeader, 4); oldBytes.set(bytes.subarray(4 + headerLength), 4 + oldHeader.length)
  writeFileSync('.audit/S1b-large.chain', bytes)
  const oldMs = [], newMs = [], saveMs = []
  for (let i = 0; i < 5; i++) {
    let start = performance.now(); legacyLoad(oldBytes); oldMs.push(+(performance.now()-start).toFixed(2))
    start = performance.now(); loadChain(bytes); newMs.push(+(performance.now()-start).toFixed(2))
    start = performance.now(); large.save(); saveMs.push(+(performance.now()-start).toFixed(2))
  }
  const cacheDir = mkdtempSync('.audit/S1b-bench-cache-')
  const reader = `import { readFileSync } from 'node:fs'; import { performance } from 'node:perf_hooks'; import { loadChain } from ${JSON.stringify(pathToFileURL(resolve('packages/cli/src/chain-cache.ts')).href)}; const bytes=readFileSync('.audit/S1b-large.chain'); const start=performance.now(); loadChain(bytes); console.log(performance.now()-start)`
  let firstForeignLoadMs, cachedCliLoadMs
  try {
    const measure = () => +Number(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', reader], { encoding: 'utf8', env: { ...process.env, FOUNDATION_CACHE_DIR: cacheDir } }).trim()).toFixed(2)
    firstForeignLoadMs = measure(); cachedCliLoadMs = measure()
  } finally { rmSync(cacheDir, { recursive: true, force: true }) }
  console.log(JSON.stringify({ firstForeignLoadMs, cachedCliLoadMs, workload: 'tracks-pane + 1000 edits', changes: large.changes().length, canonicalSnapshotWithLegacyHeaderBytes: oldBytes.length, archivedChainBytes: bytes.length, archiveHeaderBytes: headerLength, growthRatio: +(bytes.length / oldBytes.length).toFixed(2), legacyLoadMs: oldMs, archiveLoadMs: newMs, archiveCanonicalSaveMs: saveMs }))
}
console.log('PASS: legacy fixture identities retained, post-merge edit converges, canonical bytes match, old reader fails closed; exit status 0')
