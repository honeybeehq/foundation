// node --import tsx tests/chain-format-proof.mjs
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadChain } from '../packages/engine/src/chain/chain.ts'

const dir = mkdtempSync(join(tmpdir(), 'fdn-opt-in-')), cli = resolve('packages/cli/src/main.ts')
const env = { ...process.env, FOUNDATION_CHAIN_FORMAT: '1', FOUNDATION_SYNC_AUTO_OPEN: '0', FOUNDATION_REPLICA_STORE: join(dir, 'replicas'), FOUNDATION_CACHE_DIR: join(dir, 'cache') }
function run(...args) {
  console.log(`$ FOUNDATION_CHAIN_FORMAT=1 foundation ${args.join(' ')}`)
  const result = spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], { encoding: 'utf8', env })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stdout.write(result.stderr)
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}
function format(file) {
  const bytes = readFileSync(`${file}.chain`), n = bytes.readUInt32LE(0)
  return Array.isArray(JSON.parse(bytes.subarray(4, 4 + n).toString())) ? 1 : 2
}
try {
  const a = join(dir, 'local.fdn.html'), b = join(dir, 'peer.fdn.html'), shared = join(dir, 'shared')
  const version = JSON.parse(run('--version'))
  assert.deepEqual(version.chainFormats, [1, 2]); assert.equal(version.defaultChainFormat, 1)
  run('new', a)
  run('edit', a, '--author', 'user:local', '--label', 'Local-only edit', '--ops', JSON.stringify([{ op: 'set-token', name: 'local-edit', value: 'yes' }]))
  run('annotate', a, '--node', 'n1', '--text', 'Keep this local comment')
  assert.equal(format(a), 1)

  // Actual old reader source, without accessing another checkout or installing old code.
  mkdirSync('.audit', { recursive: true })
  const source = execFileSync('git', ['show', '49d3161:packages/engine/src/chain/chain.ts'], { encoding: 'utf8' })
    .replace(/from (['"])(\.[^'"]+)\1/g, (_match, quote, path) => `from ${quote}${resolve('packages/engine/src/chain', path)}${quote}`)
  const oldPath = resolve('.audit/S1c-old-reader.ts'); writeFileSync(oldPath, source)
  const { loadChain: oldLoad } = await import(pathToFileURL(oldPath).href)
  const old = oldLoad(readFileSync(`${a}.chain`))
  assert(old.verify().ok); assert.equal(old.doc().tokens['local-edit'], 'yes'); assert.equal(old.doc().annotations.length, 1)
  console.log(`PASS old 49d3161 reader opens new CLI local-only file: header v${format(a)}, edit present, comment present, history verifies`)
  let hashes = old.log().map(change => change.hash)
  // Materialize the actual 49d CLI/engine sources as a test artifact, not another checkout.
  const oldRoot = resolve('.audit/S1c-49d-runtime')
  mkdirSync(oldRoot, { recursive: true })
  const tar = execFileSync('git', ['archive', '49d3161', 'package.json', 'packages/cli', 'packages/engine', 'packages/protocol'], { maxBuffer: 32 * 1024 * 1024 })
  execFileSync('tar', ['-xf', '-', '-C', oldRoot], { input: tar })
  try { symlinkSync(resolve('node_modules'), join(oldRoot, 'node_modules')) } catch (error) { if (error.code !== 'EEXIST') throw error }
  for (const name of ['cli', 'engine', 'protocol']) {
    const deps = join(oldRoot, 'packages', name, 'node_modules'); mkdirSync(deps, { recursive: true })
    let entries = []
    try { entries = readdirSync(resolve('packages', name, 'node_modules')) } catch {}
    for (const dependency of entries) {
      const target = dependency === 'foundation-engine' ? join(oldRoot, 'packages/engine') : dependency === 'foundation-protocol' ? join(oldRoot, 'packages/protocol') : resolve('packages', name, 'node_modules', dependency)
      try { symlinkSync(target, join(deps, dependency)) } catch (error) { if (error.code !== 'EEXIST') throw error }
    }
  }
  const oldPeer = join(dir, 'old-peer.fdn.html')
  copyFileSync(a, oldPeer); copyFileSync(`${a}.chain`, `${oldPeer}.chain`)

  copyFileSync(a, b); copyFileSync(`${a}.chain`, `${b}.chain`)
  run('edit', b, '--author', 'user:peer', '--ops', JSON.stringify([{ op: 'set-token', name: 'peer-edit', value: 'yes' }]))
  assert.equal(format(b), 1)
  run('edit', a, '--author', 'user:local', '--ops', JSON.stringify([{ op: 'set-token', name: 'local-branch', value: 'yes' }]))
  hashes = oldLoad(readFileSync(`${a}.chain`)).log().map(change => change.hash)
  const legacyMerged = loadChain(readFileSync(`${a}.chain`))
  legacyMerged.merge(loadChain(readFileSync(`${b}.chain`)))
  assert.equal(legacyMerged.storageFormat(), 1)
  const localMergedReload = loadChain(legacyMerged.save())
  assert(oldLoad(localMergedReload.save()).verify().ok)
  assert.equal(oldLoad(localMergedReload.save()).doc().tokens['peer-edit'], 'yes')
  console.log('PASS old reader opens v1 after divergent local merge and reload')
  run('sync', 'open', a)
  run('sync', 'open', b)
  assert.equal(format(a), 2); assert.equal(format(b), 2)
  assert.deepEqual(loadChain(readFileSync(`${a}.chain`)).log().map(change => change.hash), hashes)
  console.log('PASS sync open upgrades each design to v2 without adding or changing history')
  let refused = false
  try { oldLoad(readFileSync(`${a}.chain`)) } catch (error) { refused = true; console.log(`Old reader after explicit sync opt-in: ${String(error)}`) }
  assert(refused)
  for (const file of [a, b, a]) run('chain', 'sync', file, shared)
  const oldCli = join(oldRoot, 'packages/cli/src/main.ts')
  for (const args of [['chain', 'sync', oldPeer, shared], ['chain', oldPeer, 'verify']]) {
    console.log(`$ actual 49d3161 foundation ${args.join(' ')}`)
    const result = spawnSync(process.execPath, ['--import', 'tsx', oldCli, ...args], { encoding: 'utf8', env })
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stdout.write(result.stderr)
    assert.equal(result.status, 0, result.stderr)
  }
  assert.equal(format(oldPeer), 1)
  assert.equal(oldLoad(readFileSync(`${oldPeer}.chain`)).doc().tokens['peer-edit'], 'yes')
  console.log('PASS v2 shared-directory change blobs remain readable by the actual 49d CLI, which writes its own v1 file')

  for (const file of [a, b]) {
    const chain = loadChain(readFileSync(`${file}.chain`))
    assert.equal(chain.storageFormat(), 2); assert(chain.verify().ok)
    assert.equal(chain.doc().tokens['local-edit'], 'yes'); assert.equal(chain.doc().tokens['peer-edit'], 'yes'); assert.equal(chain.doc().tokens['local-branch'], 'yes')
    assert.equal(chain.doc().annotations.length, 1)
    run('chain', file, 'verify')
  }
  assert(readFileSync(`${a}.chain`).equals(readFileSync(`${b}.chain`)))
  console.log(`PASS both registered copies sync in v2 with both edits, preserved comment and identical chain bytes; head ${loadChain(readFileSync(`${a}.chain`)).head().hash}`)
  console.log('PASS: compatibility until explicit sync opt-in, then archived syncing; exit status 0')
} finally { rmSync(dir, { recursive: true, force: true }) }
