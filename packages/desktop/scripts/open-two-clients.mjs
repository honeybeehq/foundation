// Human handoff: no browser automation and no generated edits.
import { spawn } from 'node:child_process'
import { mkdir, open, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import path from 'node:path'

const app = path.resolve(process.argv[2] ?? 'packages/desktop/release/Foundation.app')
const directory = path.resolve(process.argv[3] ?? `packages/desktop/.runtime-downloads/manual-${Date.now()}`)
await mkdir(path.dirname(directory), { recursive: true }); await mkdir(directory, { mode: 0o700 })
const runtime = path.join(app, 'Contents/Resources/host')
const config = path.join(directory, 'comb'), objects = path.join(directory, 'objects')
await mkdir(config, { mode: 0o700 }); await mkdir(objects, { mode: 0o700 })
await writeFile(path.join(config, 'config.toml'), `tenant = "foundation_desktop"\ndigest_key = "${randomBytes(32).toString('hex')}"\n[backend]\nkind = "local"\nroot = ${JSON.stringify(objects)}\n`, { flag: 'wx', mode: 0o600 })
const diagnostics = await open(path.join(directory, 'runtime.log'), 'wx', 0o600)
const host = spawn(path.join(runtime, 'bin/node'), [path.join(runtime, 'service/service-main.mjs'), '--state-dir', path.join(directory, 'host'), '--comb-bin', path.join(runtime, 'bin/comb'), '--comb-dir', config, '--remote', 'foundation-manual', '--port', '0'], { cwd: directory, stdio: ['ignore', 'pipe', diagnostics.fd] })
const clients = []
const exits = new Map()
function observe(child) {
  const exit = new Promise(resolve => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', error => resolve({ error: error.message })) })
  exits.set(child, exit); return exit
}
const hostExit = observe(host)
const lines = createInterface({ input: host.stdout })
let stopping = false
async function stopChild(child, timeout) {
  if (child.exitCode !== null || child.signalCode !== null) return exits.get(child)
  child.kill('SIGTERM')
  let timer
  try {
    return await Promise.race([exits.get(child), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Process shutdown timed out')), timeout) })])
  } catch (error) { child.kill('SIGKILL'); throw error }
  finally { clearTimeout(timer) }
}
async function cleanup() {
  if (stopping) return
  stopping = true; lines.close()
  const results = await Promise.allSettled(clients.map(child => stopChild(child, 30_000)))
  const hostResult = await stopChild(host, 70_000).catch(error => ({ error: error.message }))
  if (results.some(result => result.status === 'rejected' || result.value?.error || (result.value?.code !== 0 && result.value?.signal !== 'SIGTERM')) || hostResult?.error || hostResult?.code !== 0) {
    console.error('A process did not shut down cleanly. Runtime diagnostics are in the session directory.'); process.exitCode = 1
  }
  await diagnostics.close()
  console.log(`Session stopped. Saved replicas remain in ${directory}`)
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => void cleanup())
try {
  const startup = await Promise.race([
    once(lines, 'line', { signal: AbortSignal.timeout(30_000) }).then(([line]) => JSON.parse(line)),
    hostExit.then(() => { throw new Error('Host exited before startup') }),
  ])
  lines.close()
  if (stopping) throw new Error('Session interrupted during startup')
  const docId = randomUUID()
  for (const name of ['replica-a', 'replica-b']) {
    const client = spawn(path.join(app, 'Contents/MacOS/Foundation'), ['--replica-dir', path.join(directory, name), '--doc-id', docId, '--author', 'user:designer', '--host-url', startup.url, '--host-token-file', startup.tokenFile], { cwd: directory, stdio: ['ignore', diagnostics.fd, diagnostics.fd] })
    clients.push(client)
    void observe(client).then(result => {
      if (!stopping && (result.error || result.code !== 0)) { console.error('A Foundation client exited unexpectedly. Closing this session.'); process.exitCode = 1; void cleanup() }
    })
  }
  console.log(`Launching Foundation A and B with separate local replicas in ${directory}`)
  console.log('Both share one document and host. Edit offline, then open Comments & sync and click Connect in each window. Ctrl-C stops both clients and the shared host.')
  void hostExit.then(() => { if (!stopping) { console.error('Shared host exited. Closing this session.'); process.exitCode = 1; void cleanup() } })
  await Promise.all(clients.map(child => exits.get(child)))
  await cleanup()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; await cleanup()
}
