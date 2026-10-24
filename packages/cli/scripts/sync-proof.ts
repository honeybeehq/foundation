/** Real-process proof. Run: pnpm exec tsx packages/cli/scripts/sync-proof.ts /path/comb-bridge */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { loadChain } from 'foundation-engine'
import { encodeBlob } from '../../engine/src/chain/blob.js'
import { CombBridge } from '../src/sync/bridge.js'

const root = mkdtempSync(resolve('.audit/sync-run-'))
const binary = resolve(process.argv[2] ?? '/tmp/foundation-s3-comb-bridge')
const main = resolve('packages/cli/src/main.ts')
const children: ChildProcess[] = []
const transcript: string[] = []
function log(message: string): void { const line = `${new Date().toISOString()} ${message}`; transcript.push(line); console.log(line); writeFileSync(join(root, 'transcript.log'), transcript.join('\n') + '\n') }
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
function cli(store: string, ...args: string[]): string {
  const run = spawnSync(process.execPath, ['--import', 'tsx', main, ...args], { env: { ...process.env, FOUNDATION_REPLICA_STORE: store, FOUNDATION_ORIGIN_NODE: store === sa ? 'proof-node-A' : 'proof-node-B' }, encoding: 'utf8' })
  assert.equal(run.status, 0, `${args.join(' ')}: ${run.stderr}`)
  log(`CLI ${args.join(' ')} => ${run.stdout.trim()}`); return run.stdout
}
async function until(check: () => boolean, label: string, timeout = 20000): Promise<number> {
  const start = performance.now()
  while (!check()) { if (performance.now() - start > timeout) throw new Error(`timeout: ${label}`); await wait(25) }
  const elapsed = Math.round(performance.now() - start); log(`${label}: ${elapsed}ms`); return elapsed
}
function chain(file: string) { return loadChain(readFileSync(`${file}.chain`)) }
function text(file: string, id: string) { return chain(file).doc().body.find(n => n.id === id)?.text }
const a = join(root, 'a.fdn.html'), b = join(root, 'b.fdn.html'), idle = join(root, 'idle.fdn.html')
const sa = join(root, 'store-a'), sb = join(root, 'store-b'), objects = join(root, 'objects'), configDir = join(root, 'comb')
mkdirSync(configDir); mkdirSync(objects)
writeFileSync(join(configDir, 'config.toml'), `tenant = "foundation-proof"\ndigest_key = "${randomBytes(32).toString('hex')}"\n[backend]\nkind = "local"\nroot = "${objects}"\n`)
const config = join(root, 'bridge.json'); writeFileSync(config, JSON.stringify({ binary, args: ['--dir', configDir] }))
function daemon(store: string): ChildProcess {
  const child = spawn(process.execPath, ['--import', 'tsx', main, 'sync', 'serve', '--comb-config', config], { env: { ...process.env, FOUNDATION_REPLICA_STORE: store }, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child)
  child.stderr!.on('data', bytes => log(`daemon ${store === sa ? 'A' : 'B'}: ${String(bytes).trim()}`)); return child
}
function session(file: string): { events: Record<string, unknown>[] } {
  const child = spawn(process.execPath, ['--import', 'tsx', main, 'session', file], { stdio: 'pipe' }); children.push(child)
  const events: Record<string, unknown>[] = []; let buffer = ''
  child.stdout!.on('data', bytes => { buffer += String(bytes); let pos: number; while ((pos = buffer.indexOf('\n')) !== -1) { events.push({ ...JSON.parse(buffer.slice(0, pos)), receivedAt: Date.now() }); buffer = buffer.slice(pos + 1) } })
  child.stdin!.write(JSON.stringify({ t: 'hello', protocol: '0.2', client: 'sync-proof', author: 'observer' }) + '\n')
  return { events }
}
try {
  log(`proof root ${root}; binary ${binary}`)
  cli(sa, 'new', a)
  for (const dest of [b, idle]) { copyFileSync(a, dest); copyFileSync(`${a}.chain`, `${dest}.chain`) }
  const idleBytes = readFileSync(`${idle}.chain`), idleHtml = readFileSync(idle)
  const idleTimes = [statSync(idle).mtimeMs, statSync(`${idle}.chain`).mtimeMs]
  cli(sa, 'sync', 'open', a, '--workspace', 'proof', '--product', 'foundation')
  cli(sb, 'sync', 'open', b, '--workspace', 'proof', '--product', 'foundation')
  let da = daemon(sa); daemon(sb)
  await until(() => [sa, sb].every(store => JSON.parse(cliQuiet(store, 'sync', 'status', '--json'))[0]?.status === 'shared'), 'both genesis uploads acknowledged')
  const second = spawnSync(process.execPath, ['--import', 'tsx', main, 'sync', 'serve', '--comb-config', config], { env: { ...process.env, FOUNDATION_REPLICA_STORE: sa }, encoding: 'utf8', timeout: 3000 })
  assert.equal(second.status, 1); assert.match(second.stderr, /busy/); log('ONE DAEMON: second process rejected by store lock')
  const observer = session(b); await until(() => observer.events.some(e => e.t === 'welcome'), 'real session ready')
  observer.events.length = 0
  const start = performance.now()
  cli(sa, 'edit', a, '--ops', JSON.stringify([{ op: 'set-text', id: 'n1', text: 'from A' }]), '--author', 'proof-A')
  const savedMtime = statSync(`${a}.chain`).mtimeMs
  await until(() => text(b, 'n1') === 'from A', 'A save imported by B')
  await until(() => observer.events.some(e => e.t === 'doc'), 'B session emitted doc event')
  log(`chain-save mtime→session doc event ${Math.round(Number(observer.events.find(e => e.t === 'doc')!.receivedAt) - savedMtime)}ms; CLI-start→session observed ${Math.round(performance.now() - start)}ms`)
  cli(sb, 'edit', b, '--ops', JSON.stringify([{ op: 'set-text', id: 'n2', text: 'from B' }]), '--author', 'proof-B')
  await until(() => text(a, 'n2') === 'from B', 'B save imported by A')
  assert.deepEqual(chain(a).doc(), chain(b).doc()); log('CONVERGED both directions through real CLI')
  const bridge = new CombBridge(binary, ['--dir', configDir]); await bridge.hello()
  const status = JSON.parse(cliQuiet(sa, 'sync', 'status', '--json'))[0]
  const { combLog, copyKey } = await import('../src/sync/daemon.js')
  const change = chain(a).changes().at(-1)!
  const append = { log: combLog(status), idempotency_key: change.envelope.hash, payload_hex: Buffer.from(encodeBlob(change.envelope, change.bytes)).toString('hex') }
  const first = await bridge.request('append', append), again = await bridge.request('append', append)
  assert.equal(first.first, again.first); assert.equal(first.cursor, again.cursor); log(`DUPLICATE stable append original sequence=${first.first}, repeated sequence=${again.first}`); await bridge.finish()
  await wait(700)
  const beforeStat = statSync(`${a}.chain`).mtimeMs
  await wait(1000); assert.equal(statSync(`${a}.chain`).mtimeMs, beforeStat); log('NO PING-PONG: caught-up chain mtime unchanged')
  const late = join(root, 'late.fdn.html')
  copyFileSync(idle, late); copyFileSync(`${idle}.chain`, `${late}.chain`)
  cli(sa, 'sync', 'open', late, '--workspace', 'proof', '--product', 'foundation')
  await until(() => text(late, 'n1') === 'from A' && text(late, 'n2') === 'from B', 'new live copy replays full history')
  cli(sa, 'sync', 'close', late); await wait(500)
  const closedBytes = readFileSync(`${late}.chain`)
  chmodSync(objects, 0); log('BACKEND OUTAGE: chmod local object root 000 (both bridge processes denied)')
  cli(sa, 'edit', a, '--ops', JSON.stringify([{ op: 'set-text', id: 'n1', text: 'offline A' }]), '--author', 'proof-A')
  cli(sb, 'edit', b, '--ops', JSON.stringify([{ op: 'set-text', id: 'n2', text: 'offline B' }]), '--author', 'proof-B')
  cli(sa, 'annotate', a, '--text', 'offline comment A')
  cli(sb, 'annotate', b, '--text', 'offline comment B')
  assert.equal(text(a, 'n1'), 'offline A'); assert.equal(text(b, 'n2'), 'offline B'); log('LOCAL SAVES succeeded while backend denied')
  await until(() => JSON.parse(cliQuiet(sa, 'sync', 'status', '--json'))[0].lastError !== null, 'outage visible in status')
  log(`OUTAGE STATUS ${cliQuiet(sa, 'sync', 'status', '--json').trim()}`)
  // Restart one daemon while disconnected: cursor and chain outbox must survive.
  da.kill('SIGTERM'); await new Promise(resolve => da.once('exit', resolve)); da = daemon(sa); log('RESTARTED daemon A during outage')
  chmodSync(objects, 0o755); const recovery = performance.now(); log('BACKEND RESTORED')
  await until(() => text(a, 'n2') === 'offline B' && text(b, 'n1') === 'offline A' && chain(a).doc().annotations.length === 2 && chain(b).doc().annotations.length === 2, 'offline edits converge after recovery', 30000)
  log(`recovery end-to-end ${Math.round(performance.now() - recovery)}ms`)
  assert.deepEqual(chain(a).doc(), chain(b).doc()); assert.deepEqual(readFileSync(`${idle}.chain`), idleBytes); assert.deepEqual(readFileSync(idle), idleHtml)
  assert.deepEqual([statSync(idle).mtimeMs, statSync(`${idle}.chain`).mtimeMs], idleTimes)
  assert.equal(existsSync(join(sa, `${copyKey({ ...status, file: idle })}.json`)), false)
  log('IDLE COPY: HTML and chain bytes/mtime unchanged; no replica checkpoint created'); assert.deepEqual(readFileSync(`${late}.chain`), closedBytes)
  const origins = new Set(chain(a).log().map(envelope => envelope.originNode))
  assert.ok(origins.has('proof-node-A') && origins.has('proof-node-B')); log('S1 INTEGRATION: both offline comments and origin nodes survive bridge exchange')
  log('PASS convergence, duplicate append, outage saves, restart recovery, untouched idle copy')
  log(`FINAL STATUS A ${cliQuiet(sa, 'sync', 'status', '--json').trim()}`)
  log(`FINAL STATUS B ${cliQuiet(sb, 'sync', 'status', '--json').trim()}`)
  const poison = join(root, 'blocked.fdn.html')
  cli(sa, 'new', poison); cli(sa, 'sync', 'open', poison, '--workspace', 'proof', '--product', 'foundation')
  await until(() => JSON.parse(cliQuiet(sa, 'sync', 'status', '--json')).some((row: any) => row.file === poison && row.status === 'shared'), 'second design ready')
  const invalid = new CombBridge(binary, ['--dir', configDir]); await invalid.hello()
  const poisoned = JSON.parse(cliQuiet(sa, 'sync', 'status', '--json')).find((row: any) => row.file === poison)
  await invalid.request('append', { log: combLog(poisoned), idempotency_key: 'bad0', payload_hex: '00000000' }); await invalid.finish()
  await until(() => JSON.parse(cliQuiet(sa, 'sync', 'status', '--json')).some((row: any) => row.file === poison && row.status === 'blocked' && row.lastError?.includes('cursor 2')), 'invalid event is blocked at its delivery cursor')
  cli(sa, 'edit', a, '--ops', JSON.stringify([{ op: 'set-text', id: 'n1', text: 'healthy despite blocked feed' }]))
  await until(() => text(b, 'n1') === 'healthy despite blocked feed', 'blocked design does not stall healthy design')
  log(`BLOCKED STATUS ${cliQuiet(sa, 'sync', 'status', '--json').trim()}`)
  // A short lease keeps the crash probe bounded; the default lease has the same expiry contract.
  const owner = new CombBridge(binary, ['--dir', configDir, '--lease', '3']); await owner.hello()
  await owner.request('append', { log: 'foundation-lease-crash-probe', idempotency_key: '01', payload_hex: '01' }); owner.close()
  const contender = new CombBridge(binary, ['--dir', configDir, '--lease', '3']); await contender.hello()
  const takeover = performance.now()
  await contender.request('append', { log: 'foundation-lease-crash-probe', idempotency_key: '02', payload_hex: '02' })
  log(`WRITER CRASH: next writer acquired after ${Math.round(performance.now() - takeover)}ms with 3s lease`); await contender.finish()
  log('PASS extra checks: invalid feed isolated; abrupt writer crash recovers after lease expiry')

} finally {
  chmodSync(objects, 0o755)
  for (const child of children) child.kill('SIGTERM')
}
function cliQuiet(store: string, ...args: string[]): string {
  const run = spawnSync(process.execPath, ['--import', 'tsx', main, ...args], { env: { ...process.env, FOUNDATION_REPLICA_STORE: store, FOUNDATION_ORIGIN_NODE: store === sa ? 'proof-node-A' : 'proof-node-B' }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr); return run.stdout
}
