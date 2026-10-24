import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { loadChain } from 'foundation-engine'
import { CombBridge } from '../src/sync/bridge.js'
import { catalogueLog } from '../src/sync/catalogue.js'

const root = mkdtempSync(resolve('.audit/S3b-run-')), binary = resolve(process.argv[2] ?? '.audit/comb-bridge')
const sourceRoot = join(root, 'source'), freshRoot = join(root, 'fresh'), source = join(sourceRoot, 'boards/design.fdn.html'), target = join(freshRoot, 'boards/design.fdn.html')
const storeA = join(root, 'store-a'), storeB = join(root, 'store-b'), configDir = join(root, 'comb'), config = join(root, 'bridge.json')
for (const dir of [join(sourceRoot, 'boards'), freshRoot, configDir]) mkdirSync(dir, { recursive: true })
writeFileSync(join(configDir, 'config.toml'), `tenant = "materialize-proof"\ndigest_key = "${randomBytes(32).toString('hex')}"\n[backend]\nkind = "local"\nroot = "${join(root, 'objects')}"\n`)
writeFileSync(config, JSON.stringify({ binary, args: ['--dir', configDir] }))
const main = resolve('packages/cli/src/main.ts'), children: ChildProcess[] = [], lines: string[] = []
function log(message: string) { const line = `${new Date().toISOString()} ${message}`; lines.push(line); console.log(line); writeFileSync(join(root, 'transcript.log'), lines.join('\n') + '\n') }
function env(store: string) { return { ...process.env, FOUNDATION_REPLICA_STORE: store, FOUNDATION_NODE_ID: store === storeA ? 'source-node' : 'fresh-node' } }
function cli(store: string, args: string[], expected = 0, quiet = false) {
  const run = spawnSync(process.execPath, ['--import', 'tsx', main, ...args], { env: env(store), encoding: 'utf8' })
  assert.equal(run.status, expected, `${args.join(' ')}: ${run.stderr} ${run.stdout}`)
  if (!quiet) log(`CLI ${args.join(' ')} => ${run.stdout.trim() || run.stderr.trim()}`)
  return run.stdout
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(check: () => boolean, label: string) { const start = performance.now(); while (!check()) { if (performance.now() - start > 20000) throw new Error(`timeout ${label}`); await sleep(25) }; log(`${label}: ${Math.round(performance.now() - start)}ms`) }
function daemon(store: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', main, 'sync', 'serve', '--comb-config', config], { env: env(store), stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child); child.stderr!.on('data', data => log(`daemon ${store === storeA ? 'source' : 'fresh'}: ${String(data).trim()}`))
}
function text(file: string, id: string) { return loadChain(readFileSync(`${file}.chain`)).doc().body.find(node => node.id === id)?.text }
const common = ['--workspace', 'proof', '--product', 'foundation', '--comb-config', config, '--json']
try {
  log(`source HEAD ${spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()}; proof root ${root}`)
  cli(storeA, ['new', source]); cli(storeA, ['edit', source, '--ops', JSON.stringify([{ op: 'set-text', id: 'n1', text: 'source history' }])])
  cli(storeA, ['annotate', source, '--text', 'a retained source comment'])
  cli(storeA, ['sync', 'open', source, '--workspace', 'proof', '--product', 'foundation', '--repo-root', sourceRoot]); daemon(storeA)
  await until(() => JSON.parse(cli(storeA, ['sync', 'status', '--json'], 0, true))[0]?.status === 'shared', 'source envelopes shared')
  const reader = new CombBridge(binary, ['--dir', configDir]); await reader.hello(); let entry: any
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const page = await reader.request('read', { log: catalogueLog('proof'), cursor: '1', max_events: 128, max_bytes: 491520 })
      entry = (page.events as { payload_hex: string }[]).map(event => JSON.parse(Buffer.from(event.payload_hex, 'hex').toString())).at(-1)
      if (entry?.headHash === loadChain(readFileSync(`${source}.chain`)).head().hash) break
      await sleep(50)
    }
  } finally { reader.close() }
  assert.ok(entry); const entryFile = join(root, 'entry.json'); writeFileSync(entryFile, JSON.stringify(entry))
  assert.equal(existsSync(target), false); assert.equal(existsSync(`${target}.chain`), false)
  const start = performance.now()
  const ready = JSON.parse(cli(storeB, ['sync', 'materialize', '--entry', entryFile, '--repo-root', freshRoot, '--request-key', 'fresh-copy-1', ...common]))
  assert.equal(ready.state, 'ready'); assert.equal(ready.path, target); assert.equal(ready.requestKey, 'fresh-copy-1')
  assert.deepEqual(readFileSync(target), readFileSync(source)); assert.deepEqual(readFileSync(`${target}.chain`), readFileSync(`${source}.chain`))
  log(`PASS empty checkout -> catalogue path -> identical HTML and chain bytes: ${Math.round(performance.now() - start)}ms`)
  assert.equal(JSON.parse(cli(storeB, ['sync', 'status', '--json'], 0, true))[0].file, target); log('PASS restored design registered live')
  daemon(storeB)
  cli(storeA, ['edit', source, '--ops', JSON.stringify([{ op: 'set-text', id: 'n1', text: 'source after restore' }])])
  await until(() => text(target, 'n1') === 'source after restore', 'source edit reaches recovered copy')
  cli(storeB, ['edit', target, '--ops', JSON.stringify([{ op: 'set-text', id: 'n2', text: 'recovered writer edit' }])])
  await until(() => text(source, 'n2') === 'recovered writer edit', 'recovered edit reaches source')
  assert.deepEqual(readFileSync(target), readFileSync(source)); assert.deepEqual(readFileSync(`${target}.chain`), readFileSync(`${source}.chain`))
  log('PASS bidirectional edits converge with identical bytes')
  cli(storeB, ['sync', 'materialize', entry.docId, 'boards/design.fdn.html', '--repo-root', freshRoot, '--expected-head', entry.headHash, ...common])
  assert.equal(text(target, 'n2'), 'recovered writer edit'); log('PASS retry merges matching target and preserves local edits')
  const foreign = join(freshRoot, 'foreign.fdn.html'); cli(storeB, ['new', foreign]); const before = readFileSync(foreign), beforeChain = readFileSync(`${foreign}.chain`)
  const refusal = JSON.parse(cli(storeB, ['sync', 'materialize', entry.docId, 'foreign.fdn.html', '--repo-root', freshRoot, ...common], 1))
  assert.equal(refusal.code, 'path-conflict'); assert.deepEqual(readFileSync(foreign), before); assert.deepEqual(readFileSync(`${foreign}.chain`), beforeChain)
  log('PASS foreign target refused with both files unchanged')
  const absent = JSON.parse(cli(storeB, ['sync', 'materialize', 'missing-document', 'absent.fdn.html', '--repo-root', freshRoot, ...common], 1))
  assert.equal(absent.code, 'history-unavailable'); assert.equal(existsSync(join(freshRoot, 'absent.fdn.html')), false)
  log('PASS unavailable history leaves no target document')
} finally { for (const child of children) child.kill('SIGTERM') }
