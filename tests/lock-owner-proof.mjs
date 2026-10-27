// node --import tsx tests/lock-owner-proof.mjs
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { currentLockOwner } from '../packages/cli/src/lock-owner.ts'
const dir = mkdtempSync(join(tmpdir(), 'fdn-owner-proof-')), replicas = join(dir, 'replicas')
mkdirSync(replicas)
const env = { ...process.env, FOUNDATION_REPLICA_STORE: replicas, FOUNDATION_SYNC_AUTO_OPEN: '0' }
const cli = resolve('packages/cli/src/main.ts'), file = join(dir, 'board.fdn.html')
function run(...args) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], { env, encoding: 'utf8' })
  console.log(`$ foundation ${args.join(' ')}\n${r.stdout}${r.stderr}exit=${r.status}`)
  return r
}
assert.equal(run('new', file).status, 0)
const owner = currentLockOwner(), dead = { ...owner, host: 'Mac.home', pid: 2147483647 }
writeFileSync(`${file}.lock`, JSON.stringify(dead))
assert.equal(run('annotate', file, 'n1', '--text', 'after hostname change').status, 0)
console.log('PASS CLI reclaims dead owner despite changed display hostname')
const config = join(dir, 'comb.json'); writeFileSync(config, JSON.stringify({ binary: '/bin/false', args: [] }))
const lock = join(replicas, 'daemon.lock'); writeFileSync(lock, JSON.stringify(dead))
const daemon = spawn(process.execPath, ['--import', 'tsx', cli, 'sync', 'serve', '--comb-config', config], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''; daemon.stdout.on('data', b => output += b); daemon.stderr.on('data', b => output += b)
try {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && (!existsSync(lock) || JSON.parse(readFileSync(lock, 'utf8')).pid !== daemon.pid)) await new Promise(r => setTimeout(r, 20))
  assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, daemon.pid, output)
  console.log('PASS real daemon starts after dead-owner hostname change')
  const blocked = run('sync', 'serve', '--comb-config', config)
  assert.equal(blocked.status, 1); assert.match(blocked.stderr, /busy/)
  assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, daemon.pid)
  console.log('PASS live daemon owner blocks a second real daemon')
} finally { daemon.kill('SIGTERM'); await new Promise(r => daemon.once('exit', r)) }
// Two independent breakers race for one stale singleton; only one may hold it.
for (const target of [file, join(replicas, 'daemon')]) {
writeFileSync(`${target}.lock`, JSON.stringify(dead))
const code = `import { acquireDocumentLock } from ${JSON.stringify(new URL('../packages/cli/src/document-lock.ts', import.meta.url).href)}; try { const release = acquireDocumentLock(${JSON.stringify(target)}, 100); console.log('acquired'); setTimeout(() => { release(); process.exit(0) }, 500) } catch { process.exit(2) }`
function contender() {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.once('exit', status => resolve(status))
  })
}
const statuses = (await Promise.all([contender(), contender()])).sort()
assert.deepEqual(statuses, [0, 2])
console.log(`PASS concurrent stale breakers for ${target}: exactly one acquires, one stays busy`)
}
console.log('PASS lock proof; exit=0')
