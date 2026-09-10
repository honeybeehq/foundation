#!/usr/bin/env node
// A persistent owner holds the actual Playwright/child-process handles. CLI invocations
// never reconnect to arbitrary CDP ports or signal a PID recovered from a stale file.
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdir, readFile, writeFile, appendFile, readdir, realpath, open, rename } from 'node:fs/promises'
import { createHash, randomUUID, randomBytes } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const exec = promisify(execFile)
const script = fileURLToPath(import.meta.url)
export const root = path.resolve(path.dirname(script), '../../..')
const desktop = path.join(root, 'packages/desktop')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const json = value => JSON.stringify(value, null, 2) + '\n'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const readJSON = async file => JSON.parse(await readFile(file, 'utf8'))
const writeJSON = (file, value) => writeFile(file, json(value), { mode: 0o600 })

export const HELP = `control-foundation — real Foundation UI, isolated local host and Comb

node packages/desktop/scripts/control-foundation.mjs <command> --run <directory> [options]

launch --runtime <host-directory> [--clients 1|2] [--app <Foundation.app>]
  Builds current desktop source by default. --app explicitly drives that package instead.
  Refuses an existing run directory. Uses a fresh private local Comb backend and replicas.
  --runtime is required for source mode; packaged mode uses its bundled host.
doctor                  Read-only identity, build freshness, host and renderer checks
snapshot                ARIA tree, visible text, controls, selection and save status
state                   Read-only persisted host document/status through the real preload
screenshot              PNG under evidence/ (also captures snapshot and persisted state)
viewport <width> <height> Set emulated content viewport (default 1440x900; not native bounds)
click <selector>         Click a unique visible enabled control
fill <selector> <value>  Fill a unique visible editable field; blur commits inspector edits
select <selector> <value> Select an option through the UI change event
press <key>             Playwright key, e.g. Escape or Meta+z (focus matters)
wait <selector> <text>   Wait for visible text to contain the given text
wait-state <path> <json> Wait for exact stored value, e.g. status.pending 0
restart                 Close/reopen selected client with its existing replica; saves survive
stop                    Close all owned clients and host; preserve state and evidence
cleanup                 Stop, then move scratch state into .trash/; evidence survives

UI commands: --client a|b (default a), --label <feature-entry>, --input dom|pointer
Default input is DOM events through real handlers, checked for visibility/enabled state.
Pointer mode uses Playwright input for actual targeting. Neither proves native save dialogs.
Every command prints JSON and returns nonzero on failure. No arbitrary eval/mutation API.
Each UI action records before/after snapshots, stored state, and a screenshot after.
Artifacts and actions.jsonl survive stop/cleanup. Runtime logs may contain document text.
One command at a time per run; separate run directories can operate concurrently.
`

export function parseArgs(argv) {
  const positionals = [], flags = {}
  const allowed = new Set(['run', 'runtime', 'clients', 'app', 'client', 'label', 'input'])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') { positionals.push(...argv.slice(i + 1)); break }
    if (!arg.startsWith('--')) { positionals.push(arg); continue }
    const name = arg.slice(2)
    if (!allowed.has(name)) throw new Error(`Unknown option ${arg}; run help`)
    if (flags[name] !== undefined) throw new Error(`Duplicate ${arg}`)
    const value = argv[++i]
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
    flags[name] = value
  }
  const [command = 'help', ...args] = positionals
  if (flags.client && !['a', 'b'].includes(flags.client)) throw new Error('--client must be a or b')
  if (flags.clients && !['1', '2'].includes(flags.clients)) throw new Error('--clients must be 1 or 2')
  if (flags.input && !['dom', 'pointer'].includes(flags.input)) throw new Error('--input must be dom or pointer')
  return { command, args, flags }
}

export function atPath(value, key) {
  if (!key || key.split('.').some(part => ['__proto__', 'constructor', 'prototype'].includes(part))) throw new Error('Use a dot-separated own-property path')
  for (const part of key.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined
    value = value[part]
  }
  return value
}

async function hashTree(directory) {
  const files = []
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(file)
      else if (entry.isFile()) files.push([path.relative(directory, file), digest(await readFile(file))])
      else throw new Error(`Unexpected non-regular build input: ${file}`)
    }
  }
  await walk(directory)
  return digest(JSON.stringify(files))
}
async function sourceHash() {
  return digest(JSON.stringify([
    await hashTree(path.join(desktop, 'src')),
    digest(await readFile(path.join(root, 'spikes/desktop-prototype/index.html'))),
    digest(await readFile(path.join(desktop, 'scripts/build.mjs'))),
    digest(await readFile(path.join(root, 'pnpm-lock.yaml'))),
  ]))
}
export async function bounded(promise, ms, message) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) })]) }
  finally { clearTimeout(timer) }
}

async function owner(run) {
  const { _electron: electron } = await import('playwright')
  const config = await readJSON(path.join(run, 'config.json'))
  const evidence = path.join(run, 'evidence'), scratch = path.join(run, 'scratch')
  const metadata = { version: 1, id: randomUUID(), phase: 'starting', run, root, mode: config.app ? 'package' : 'source', ownerPid: process.pid, clients: {}, errors: [], startedAt: new Date().toISOString() }
  const token = randomBytes(32).toString('hex')
  const save = async () => {
    const file = path.join(run, 'session.json')
    await writeJSON(file + '.next', metadata); await rename(file + '.next', file)
  }
  await save()
  let host, server, stopping = false, interrupted = false, busy = false, sequence = 0, hostInfo, dist
  const checkStartup = () => { if (interrupted) throw new Error('Launch interrupted; owned processes will be closed') }
  const clients = new Map(), exits = new Map()
  const logs = await open(path.join(evidence, 'runtime.log'), 'a', 0o600)
  const log = text => logs.appendFile(text).catch(() => {})
  function observe(child) {
    const exited = new Promise(resolve => {
      child.once('exit', (code, signal) => resolve({ code, signal }))
      child.once('error', error => resolve({ error: error.message }))
    })
    exits.set(child, exited)
    return exited
  }
  async function stopHost() {
    if (!host) return
    if (host.exitCode === null && host.signalCode === null) host.kill('SIGTERM')
    try {
      const result = await bounded(exits.get(host), 70_000, 'Host did not stop within 70 seconds')
      metadata.hostExit = result
      if (result.code !== 0) throw new Error(`Unclean host exit: ${JSON.stringify(result)}`)
    } catch (error) {
      if (host.pid && host.exitCode === null && host.signalCode === null) process.kill(-host.pid, 'SIGKILL')
      await bounded(exits.get(host), 5_000, 'Host force-stop unconfirmed')
      throw error
    }
  }
  async function closeClient(name) {
    const client = clients.get(name)
    if (!client) return
    const child = client.app.process()
    try {
      await bounded(client.app.close(), 30_000, `Client ${name} shutdown timed out`)
      const result = await bounded(exits.get(child), 5_000, `Client ${name} exit unconfirmed`)
      metadata.clients[name].exit = result
      if (result.code !== 0) throw new Error(`Unclean client ${name} exit: ${JSON.stringify(result)}`)
    } catch (error) {
      metadata.errors.push(`Client ${name} lifecycle: ${error.message}`)
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await bounded(exits.get(child), 5_000, `Client ${name} force-stop unconfirmed`)
      throw error
    } finally { clients.delete(name) }
  }
  async function shutdown(cleanup = false) {
    if (stopping) return metadata
    stopping = true; metadata.phase = 'stopping'; await save()
    for (const name of [...clients.keys()]) {
      try { await closeClient(name) } catch (error) { metadata.errors.push(error.message) }
    }
    try { await stopHost() } catch (error) { metadata.errors.push(error.message) }
    metadata.phase = metadata.errors.length ? 'failed' : 'stopped'
    metadata.stoppedAt = new Date().toISOString()
    if (cleanup && !metadata.errors.length) {
      await mkdir(path.join(run, '.trash'), { mode: 0o700 })
      await rename(scratch, path.join(run, '.trash/scratch'))
      metadata.scratchArchived = true
    }
    await save(); await writeJSON(path.join(evidence, 'lifecycle.json'), metadata)
    await logs.close()
    return metadata
  }
  async function finish(cleanup = false) {
    const result = await shutdown(cleanup)
    server?.close(); return result
  }
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, () => {
    if (metadata.phase === 'starting') { interrupted = true; return }
    void finish().then(() => process.exit(metadata.errors.length ? 1 : 0))
  })
  async function launchClient(name) {
    const replica = path.join(scratch, `replica-${name}`)
    const args = ['--replica-dir', replica, '--doc-id', metadata.id, '--author', 'user:verification', '--host-url', hostInfo.url, '--host-token-file', hostInfo.tokenFile]
    const options = config.app
      ? { executablePath: path.join(config.app, 'Contents/MacOS/Foundation'), args }
      : { executablePath: (await import('electron')).default, args: [desktop, ...args] }
    const app = await electron.launch({ ...options, cwd: run, timeout: 45_000 })
    const child = app.process(); observe(child)
    const client = { app, page: null }
    clients.set(name, client)
    metadata.clients[name] = { pid: child.pid, replica }
    child.stderr?.on('data', data => void log(`Client ${name}: ${data}`))
    const page = await app.firstWindow({ timeout: 45_000 }); client.page = page
    // Window managers can retile native windows. Keep evidence and responsive
    // layout repeatable without fighting the operator's desktop arrangement.
    await page.setViewportSize({ width: 1440, height: 900 })
    page.setDefaultTimeout(15_000)
    page.on('pageerror', error => { metadata.errors.push(`Renderer ${name}: ${error.message}`); void log(`Renderer ${name}: ${error.stack}\n`) })
    page.on('console', message => { if (message.type() === 'error') void log(`Console ${name}: ${message.text()}\n`) })
    page.on('dialog', async dialog => { void log(`Dismissed ${dialog.type()}: ${dialog.message()}\n`); await dialog.dismiss() })
    await page.waitForFunction(() => window.foundationSession?.canEdit(), undefined, { timeout: 45_000, polling: 100 })
    const state = await page.evaluate(() => window.foundationHost.state())
    metadata.clients[name].replicaId = state.status.replicaId
    await save()
    checkStartup()
    return client
  }
  async function snapshot(page) {
    return {
      aria: await page.locator('body').ariaSnapshot(),
      ...await page.evaluate(() => ({
        url: location.href, title: document.title, text: document.body.innerText,
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        selection: window.foundationEditor.selection(), canEdit: window.foundationSession.canEdit(),
        footer: document.querySelector('#save-status')?.textContent,
        error: document.querySelector('#host-error')?.textContent,
        controls: [...document.querySelectorAll('button,input,textarea,select,[role="button"]')].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden').map(el => ({
          tag: el.tagName.toLowerCase(), id: el.id, name: el.getAttribute('aria-label') || el.textContent?.trim(),
          value: el.value, disabled: el.disabled, select: el.getAttribute('data-select'), prop: el.getAttribute('data-prop'),
        })),
      })),
    }
  }
  async function capture(page, prefix, screen = false) {
    const ui = await snapshot(page)
    await writeJSON(path.join(evidence, `${prefix}.ui.json`), ui)
    await writeJSON(path.join(evidence, `${prefix}.state.json`), await page.evaluate(() => window.foundationHost.state()))
    if (screen) await page.screenshot({ path: path.join(evidence, `${prefix}.png`), scale: 'css', timeout: 20_000 })
    return ui
  }
  async function doctor() {
    const checks = []
    const check = (name, ok, remedy) => checks.push({ name, ok, ...(ok ? {} : { remedy }) })
    check('host process alive', host.exitCode === null && host.signalCode === null, 'Stop and launch a fresh run; inspect runtime.log')
    check('all expected clients alive', clients.size === config.clients && [...clients.values()].every(({ app, page }) => page && !page.isClosed() && app.process().exitCode === null && app.process().signalCode === null), 'A client is missing or closed; inspect the failed action and launch a fresh run')
    for (const [file, hash] of Object.entries(metadata.build.runtimeHashes)) check(`runtime unchanged: ${file}`, digest(await readFile(path.join(config.runtime, file))) === hash, 'Stop and launch with the intended immutable runtime')
    check('loaded build unchanged', await hashTree(dist) === metadata.build.distHash, 'Stop and launch again after rebuilding')
    if (!config.app) check('source unchanged since build', await sourceHash() === metadata.build.sourceHash, 'Stop and launch a new source run')
    for (const [name, { page }] of clients) {
      try {
        const state = await page.evaluate(() => window.foundationHost.state())
        check(`${name}: expected page`, page.url().split('?')[0] === pathToFileURL(path.join(dist, 'index.html')).href, 'Stop: wrong renderer target')
        check(`${name}: own document/replica`, state.status.docId === metadata.id && state.status.replicaId === metadata.clients[name].replicaId, 'Stop: instance identity mismatch')
        check(`${name}: editor ready`, await page.evaluate(() => window.foundationSession.canEdit()), 'Inspect snapshot and runtime.log; do not retry a mutation blindly')
      } catch (error) { check(`${name}: host/renderer reachable`, false, error.message) }
    }
    check('no renderer/lifecycle errors', metadata.errors.length === 0, 'Inspect session errors and evidence/runtime.log')
    return { ok: checks.every(c => c.ok), checks, session: metadata }
  }
  async function dispatch({ command, args, flags }) {
    if (command === 'doctor') return doctor()
    if (command === 'stop' || command === 'cleanup') return { ok: (await shutdown(command === 'cleanup')).phase === 'stopped', session: metadata }
    const name = flags.client ?? 'a'
    const client = clients.get(name)
    if (!client?.page) throw new Error(`No client ${name}; launch with --clients 2 for client b`)
    let page = client.page
    const allowed = new Set(['snapshot', 'state', 'screenshot', 'viewport', 'click', 'fill', 'select', 'press', 'wait', 'wait-state', 'restart'])
    if (!allowed.has(command)) throw new Error(`Unknown command ${command}; run help`)
    const count = { snapshot: 0, state: 0, screenshot: 0, viewport: 2, restart: 0, click: 1, fill: 2, select: 2, press: 1, wait: 2, 'wait-state': 2 }[command]
    if (args.length !== count) throw new Error(`${command} requires ${count} argument(s); run help`)
    const label = (flags.label ?? command).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80)
    const prefix = `${String(++sequence).padStart(4, '0')}-${name}-${label}`
    const entry = { at: new Date().toISOString(), command, args, client: name, input: flags.input ?? 'dom', label: flags.label ?? command, prefix }
    await appendFile(path.join(evidence, 'actions.jsonl'), JSON.stringify({ ...entry, phase: 'started' }) + '\n')
    try {
      await capture(page, prefix + '-before')
      let result
      const target = args[0] && ['click', 'fill', 'select'].includes(command) ? page.locator(args[0]) : null
      if (target) {
        if (await target.count() !== 1) throw new Error(`Selector must match exactly one control: ${args[0]}`)
        if (!await target.isVisible() || !await target.isEnabled()) throw new Error(`Control must be visible and enabled: ${args[0]}`)
      }
      if (command === 'click') {
        if (flags.input === 'pointer') await target.click()
        else await target.evaluate(el => el.click())
      } else if (command === 'fill') {
        if (!await target.isEditable()) throw new Error('Field is not editable')
        if (flags.input === 'pointer') await target.fill(args[1])
        else await target.evaluate((el, value) => {
          if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) throw new Error('DOM fill requires an input or textarea')
          el.focus(); el.value = value
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }, args[1])
        if (await target.inputValue() !== args[1]) throw new Error('Field did not retain requested value')
        await target.blur()
      } else if (command === 'viewport') {
        const [width, height] = args.map(Number)
        if (![width, height].every(n => Number.isInteger(n) && n >= 320 && n <= 4000)) throw new Error('Viewport dimensions must be integers from 320 to 4000')
        await page.setViewportSize({ width, height })
        result = { width, height, emulated: true }
      } else if (command === 'select') await target.selectOption(args[1])
      else if (command === 'press') await page.keyboard.press(args[0])
      else if (command === 'wait') {
        await page.locator(args[0]).waitFor({ state: 'visible', timeout: 45_000 })
        const deadline = Date.now() + 45_000
        while (!(await page.locator(args[0]).innerText()).includes(args[1])) {
          if (Date.now() > deadline) throw new Error(`Visible text did not contain ${args[1]}`)
          await sleep(150)
        }
      } else if (command === 'wait-state') {
        const expected = JSON.parse(args[1]); atPath({}, args[0])
        const deadline = Date.now() + 45_000
        while (true) {
          const state = await page.evaluate(() => window.foundationHost.state())
          const actual = atPath(state, args[0])
          if (JSON.stringify(actual) === JSON.stringify(expected)) { result = state; break }
          if (Date.now() > deadline) throw new Error(`Stored ${args[0]} did not become ${args[1]}; observed ${JSON.stringify(actual)}`)
          await sleep(150)
        }
      } else if (command === 'restart') {
        const before = await page.evaluate(() => window.foundationHost.state())
        await closeClient(name); page = (await launchClient(name)).page
        const after = await page.evaluate(() => window.foundationHost.state())
        if (before.status.replicaId !== after.status.replicaId || JSON.stringify(before.document) !== JSON.stringify(after.document)) throw new Error('Saved document or replica identity changed across restart')
        result = { persisted: true, replicaId: after.status.replicaId }
      }
      // Event dispatch is not a save receipt. Wait for local UI writes to settle;
      // callers still assert the feature's exact stored result with wait-state.
      await page.waitForFunction(() => !document.querySelector('#save-status')?.textContent?.startsWith('Saving locally'), undefined, { timeout: 45_000, polling: 100 })
      const ui = await capture(page, prefix + '-after', true)
      if (['click', 'fill', 'select', 'press'].includes(command) && !ui.canEdit) throw new Error(`Editor cannot confirm writes: ${ui.footer}. Inspect state before retrying.`)
      if (command === 'state') result = await page.evaluate(() => window.foundationHost.state())
      if (command === 'snapshot') result = ui
      if (command === 'screenshot') result = { path: path.join(evidence, `${prefix}-after.png`) }
      const outcome = { ok: true, result, evidence: path.join(evidence, prefix + '-after'), footer: ui.footer }
      await appendFile(path.join(evidence, 'actions.jsonl'), JSON.stringify({ ...entry, phase: 'completed', ...outcome }) + '\n')
      return outcome
    } catch (error) {
      await capture(page, prefix + '-failure', true).catch(() => {})
      await appendFile(path.join(evidence, 'actions.jsonl'), JSON.stringify({ ...entry, phase: 'failed', error: error.message }) + '\n')
      throw error
    }
  }
  try {
    await mkdir(scratch, { mode: 0o700 })
    dist = config.app ? path.join(config.app, 'Contents/Resources/app/dist') : path.join(desktop, 'dist')
    let source
    if (!config.app) {
      source = await sourceHash()
      const build = await exec('pnpm', ['--filter', 'foundation-desktop', 'build'], { cwd: root, timeout: 120_000 })
      await writeFile(path.join(evidence, 'build.log'), build.stdout + build.stderr)
      if (source !== await sourceHash()) throw new Error('Source changed during build; launch a fresh run')
    }
    checkStartup()
    const runtime = config.runtime
    const runtimeHashes = {}
    for (const file of ['runtime.json', 'service/service-main.mjs', 'bin/node', 'bin/comb']) runtimeHashes[file] = digest(await readFile(path.join(runtime, file)))
    metadata.build = { dist, distHash: await hashTree(dist), ...(source ? { sourceHash: source } : {}), runtime, runtimeHashes, gitHead: (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim() }
    await mkdir(path.join(scratch, 'comb'), { mode: 0o700 }); await mkdir(path.join(scratch, 'objects'), { mode: 0o700 })
    await writeFile(path.join(scratch, 'comb/config.toml'), `tenant = "foundation_desktop"\ndigest_key = "${randomBytes(32).toString('hex')}"\n[backend]\nkind = "local"\nroot = ${JSON.stringify(path.join(scratch, 'objects'))}\n`, { mode: 0o600, flag: 'wx' })
    host = spawn(path.join(runtime, 'bin/node'), [path.join(runtime, 'service/service-main.mjs'), '--state-dir', path.join(scratch, 'host'), '--comb-bin', path.join(runtime, 'bin/comb'), '--comb-dir', path.join(scratch, 'comb'), '--remote', 'foundation-verification', '--port', '0'], { cwd: run, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const hostExit = observe(host)
    metadata.hostPid = host.pid
    host.stderr.on('data', data => void log(`Host: ${data}`))
    const lines = createInterface({ input: host.stdout })
    try {
      hostInfo = await Promise.race([
        once(lines, 'line', { signal: AbortSignal.timeout(30_000) }).then(([line]) => JSON.parse(line)),
        hostExit.then(result => { throw new Error(`Host exited during startup: ${JSON.stringify(result)}`) }),
      ])
    } finally { lines.close(); host.stdout.resume() }
    const hostURL = new URL(hostInfo.url)
    if (hostURL.protocol !== 'http:' || hostURL.hostname !== '127.0.0.1' || typeof hostInfo.tokenFile !== 'string') throw new Error('Host did not return loopback startup identity')
    metadata.hostURL = hostInfo.url
    checkStartup()
    await launchClient('a')
    if (config.clients === 2) await launchClient('b')
    checkStartup()
    if (config.clients === 2 && metadata.clients.a.replicaId === metadata.clients.b.replicaId) throw new Error('Clients share a replica identity')
    server = createServer(async (request, response) => {
      response.setHeader('Content-Type', 'application/json')
      if (request.headers.authorization !== `Bearer ${token}` || request.method !== 'POST' || request.url !== '/') { response.writeHead(403); response.end(json({ ok: false, error: 'Unauthorized control request' })); return }
      if (busy || stopping) { response.writeHead(409); response.end(json({ ok: false, error: 'Run is busy or stopping; commands must be sequential' })); return }
      busy = true
      let command
      try {
        let body = ''
        for await (const chunk of request) { body += chunk; if (body.length > 100_000) throw new Error('Control request too large') }
        const input = JSON.parse(body); command = input.command
        const result = await dispatch(input)
        response.end(json(result))
      } catch (error) { response.writeHead(400); response.end(json({ ok: false, error: error.message, evidence })) }
      finally {
        busy = false
        if (command === 'stop' || command === 'cleanup') server.close()
      }
    })
    server.requestTimeout = 10_000
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    await writeJSON(path.join(run, 'connection.json'), { id: metadata.id, url: `http://127.0.0.1:${server.address().port}`, token })
    metadata.phase = 'ready'; await save()
  } catch (error) {
    metadata.errors.push(error.message)
    await finish(); process.exitCode = 1
  }
}

async function launch(flags) {
  if (!flags.run) throw new Error('launch requires --run <fresh directory>')
  const run = path.resolve(flags.run)
  const app = flags.app ? await realpath(flags.app) : undefined
  const runtime = await realpath(flags.runtime ?? (app ? path.join(app, 'Contents/Resources/host') : (() => { throw new Error('Source launch requires --runtime <Foundation.app/Contents/Resources/host>') })()))
  for (const file of ['runtime.json', 'service/service-main.mjs', 'bin/node', 'bin/comb']) await readFile(path.join(runtime, file))
  await mkdir(path.dirname(run), { recursive: true }); await mkdir(run, { mode: 0o700 })
  await mkdir(path.join(run, 'evidence'), { mode: 0o700 })
  await writeJSON(path.join(run, 'config.json'), { runtime, app, clients: Number(flags.clients ?? 1) })
  const log = await open(path.join(run, 'evidence/owner.log'), 'wx', 0o600)
  const child = spawn(process.execPath, [script, '__owner', run], { detached: true, cwd: root, stdio: ['ignore', log.fd, log.fd] })
  let launchError
  child.once('error', error => { launchError = error; void writeJSON(path.join(run, 'launch-error.json'), { error: error.message }).catch(() => {}) })
  child.unref(); await log.close()
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    if (launchError) throw new Error(`Could not start control owner: ${launchError.message}; inspect ${run}/launch-error.json`)
    let state
    try { state = await readJSON(path.join(run, 'session.json')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (state?.phase === 'ready') return { ok: true, session: state }
    if (state && ['failed', 'stopped'].includes(state.phase)) return { ok: false, session: state }
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Owner exited during launch; inspect ${run}/evidence/owner.log`)
    await sleep(200)
  }
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  await bounded(once(child, 'exit'), 160_000, `Launch cleanup unconfirmed; inspect ${run}/evidence/owner.log`)
  throw new Error(`Launch deadline exceeded; owned processes were stopped. Inspect ${run}/session.json; use a fresh directory.`)
}

export async function main(argv) {
  if (argv[0] === '__owner') return owner(argv[1])
  const input = parseArgs(argv)
  if (['help', '-h'].includes(input.command)) return { ok: true, help: HELP }
  if (input.command === 'launch') return launch(input.flags)
  if (!input.flags.run) throw new Error('Specify --run <directory>; run help for commands')
  const run = path.resolve(input.flags.run)
  const session = await readJSON(path.join(run, 'session.json'))
  if (['stopped', 'failed'].includes(session.phase)) {
    if (['stop', 'cleanup'].includes(input.command)) {
      if (input.command === 'cleanup' && session.phase === 'stopped' && !session.scratchArchived) {
        await mkdir(path.join(run, '.trash'), { mode: 0o700 })
        await rename(path.join(run, 'scratch'), path.join(run, '.trash/scratch'))
        session.scratchArchived = true; await writeJSON(path.join(run, 'session.json'), session)
        await writeJSON(path.join(run, 'evidence/lifecycle.json'), session)
      }
      return { ok: session.phase === 'stopped', session }
    }
    return { ok: false, error: `Session is ${session.phase}; launch a fresh run`, session }
  }
  const connection = await readJSON(path.join(run, 'connection.json'))
  const url = new URL(connection.url)
  if (connection.id !== session.id || url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Invalid control identity; refusing to contact another instance')
  try {
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(160_000) })
    return await response.json()
  } catch (error) { throw new Error(`Owner unavailable or command timed out: ${error.message}. Inspect ${run}/evidence/owner.log and session.json; do not retry mutations or kill stale PIDs blindly.`) }
}
if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  main(process.argv.slice(2)).then(result => {
    if (result !== undefined) { process.stdout.write(json(result)); if (!result.ok) process.exitCode = 1 }
  }).catch(error => { process.stdout.write(json({ ok: false, error: error.message })); process.exitCode = 1 })
}
