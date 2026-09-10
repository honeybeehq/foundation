// Explicit integration acceptance against the real packaged host and Comb bridge.
import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomBytes, createHash } from 'node:crypto'
import { createInterface } from 'node:readline'
import path from 'node:path'

const appPath = path.resolve(process.argv[2] ?? 'packages/desktop/release/Foundation-development.app')
const proof = path.resolve(process.argv[3] ?? `packages/desktop/.runtime-downloads/proof-${Date.now()}`)
await mkdir(path.dirname(proof), { recursive: true })
await mkdir(proof) // Refuse reuse, including a directory containing an old report.
const resources = path.join(appPath, 'Contents/Resources'), executablePath = path.join(appPath, 'Contents/MacOS/Foundation')
const runtime = path.join(resources, 'host')
const config = path.join(proof, 'comb'), objects = path.join(proof, 'objects')
await mkdir(config, { recursive: true, mode: 0o700 }); await mkdir(objects, { recursive: true })
await writeFile(path.join(config, 'config.toml'), `tenant = "foundation_desktop"\ndigest_key = "${randomBytes(32).toString('hex')}"\n[backend]\nkind = "local"\nroot = ${JSON.stringify(objects)}\n`, { mode: 0o600, flag: 'wx' })
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex')
const report = { appPath, proof, checks: [], screenshots: [], passed: false, interaction: 'DOM clicks and input events through actual renderer handlers; real preload/HTTP/Comb, no direct host mutation', hashes: {
  hostEntry: await digest(path.join(runtime, 'service/service-main.mjs')),
  comb: await digest(path.join(runtime, 'bin/comb')),
  node: await digest(path.join(runtime, 'bin/node')),
  desktopMain: await digest(path.join(resources, 'app/dist/main.cjs')),
  desktopRenderer: await digest(path.join(resources, 'app/dist/renderer.js')),
} }
const host = spawn(path.join(runtime, 'bin/node'), [path.join(runtime, 'service/service-main.mjs'), '--state-dir', path.join(proof, 'host'), '--comb-bin', path.join(runtime, 'bin/comb'), '--comb-dir', config, '--remote', 'desktop-proof', '--port', '0'], { cwd: proof, stdio: ['ignore', 'pipe', 'pipe'] })
const hostExit = new Promise(resolve => {
  host.once('exit', (code, signal) => resolve({ code, signal }))
  host.once('error', error => resolve({ code: null, signal: null, error: error.message }))
})
let diagnostics = ''; host.stderr.on('data', data => { diagnostics += data })
const lines = createInterface({ input: host.stdout })
let url, tokenFile
const apps = new Set()
const owners = new WeakMap()
const log = message => { report.checks.push(message); console.log(message) }
async function launch(directory, external = true) {
  const application = await electron.launch({ executablePath, cwd: proof, args: ['--replica-dir', path.join(proof, directory), '--author', 'user:same-designer', ...(external ? ['--host-url', url, '--host-token-file', tokenFile, '--doc-id', 'desktop-live-proof'] : [])], timeout: 45_000 })
  apps.add(application)
  application.process().stderr.on('data', data => { diagnostics += `\nDesktop ${directory}: ${data}` })
  const page = await application.firstWindow({ timeout: 45_000 })
  owners.set(page, application)
  page.setDefaultTimeout(45_000)
  page.on('pageerror', error => { diagnostics += `\nRenderer: ${error.message}` })
  await activate(page)
  try { await page.waitForFunction(() => window.foundationSession?.canEdit(), undefined, { timeout: 45_000, polling: 100 }) }
  catch (error) {
    const startup = await page.evaluate(() => ({ url: location.href, ready: document.readyState, session: typeof window.foundationSession, status: document.querySelector('#save-status')?.textContent, error: document.querySelector('#host-error')?.textContent })).catch(error => ({ inspectionError: String(error) }))
    diagnostics += `\nStartup ${directory}: ${JSON.stringify(startup)}`
    console.error(`Startup ${directory}:`, startup)
    throw error
  }
  return { application, page }
}
async function activate(page) {
  await owners.get(page).evaluate(({ app, BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); app.focus({ steal: true }) })
  await page.bringToFront()
}
async function close(instance) {
  await bounded(instance.application.close(), 30_000, 'Desktop shutdown exceeded 30 seconds')
  apps.delete(instance.application)
}
async function bounded(promise, milliseconds, message) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds) })]) }
  finally { clearTimeout(timer) }
}
const current = page => page.evaluate(() => window.foundationHost.state())
async function settle(page, predicate) {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const state = await current(page)
    if (predicate(state)) return state
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error(`State did not settle: ${JSON.stringify((await current(page)).status)}`)
}
async function edit(page, id, text) {
  await activate(page)
  await click(page, `#layer-tree [data-select="${id}"]`)
  assert.equal(await page.evaluate(() => window.foundationEditor.selection()), id, 'Layer UI must select the intended node before editing')
  const field = page.locator('#text-content')
  await fillField(page, '#text-content', text); await field.blur()
  await settle(page, state => state.document.body.flatMap(root => root.children).find(n => n.id === id)?.text === text)
}
async function comment(page, text) {
  await activate(page)
  await click(page, '[data-future="comments"]')
  await fillField(page, '#comment-text', text)
  await inspectCommentState(page)
  assert.equal(await page.locator('#post-comment').isDisabled(), false, 'Post must be enabled before submission')
  await click(page, '#post-comment')
  await settle(page, state => state.document.annotations.some(a => a.text === text))
  assert.equal(await page.locator('#comment-text').inputValue(), '', 'Comment clears only after the renderer receives a local save receipt')
}
async function inspectCommentState(page) {
  const ui = await page.evaluate(() => ({
    value: document.querySelector('#comment-text').value,
    disabled: document.querySelector('#post-comment').disabled,
    canEdit: window.foundationSession.canEdit(), focus: document.hasFocus(), active: document.activeElement?.id,
    footer: document.querySelector('#save-status').textContent, error: document.querySelector('#host-error').textContent,
    textareas: document.querySelectorAll('#comment-text').length,
  }))
  const session = await page.context().newCDPSession(page)
  const pendingState = {}
  try {
    const fn = await session.send('Runtime.evaluate', { expression: 'window.foundationSession.edit' })
    const props = await session.send('Runtime.getProperties', { objectId: fn.result.objectId })
    const scopeList = props.internalProperties?.find(p => p.name === '[[Scopes]]')?.value?.objectId
    if (scopeList) {
      const scopes = await session.send('Runtime.getProperties', { objectId: scopeList })
      for (const scope of scopes.result) if (scope.value?.objectId && /^\d+$/.test(scope.name)) {
        const variables = await session.send('Runtime.getProperties', { objectId: scope.value.objectId })
        for (const variable of variables.result) if (['pending', 'ready', 'failed', 'unconfirmed'].includes(variable.name)) pendingState[variable.name] = variable.value?.value
      }
    }
    const field = await session.send('Runtime.evaluate', { expression: 'document.querySelector("#comment-text")' })
    const listeners = await session.send('DOMDebugger.getEventListeners', { objectId: field.result.objectId })
    pendingState.inputListeners = listeners.listeners.map(l => ({ type: l.type, line: l.lineNumber, script: l.scriptId }))
  } catch (error) { pendingState.inspectionError = String(error) }
  finally { await session.detach() }
  report.commentStates ??= []
  report.commentStates.push({ ...ui, ...pendingState })
  diagnostics += `\nComment state before submit: ${JSON.stringify({ ...ui, ...pendingState })}`
  console.log('Comment readiness:', JSON.stringify({ ...ui, ...pendingState }))
}
async function click(page, selector) {
  const target = page.locator(selector)
  assert.equal(await target.isVisible(), true, `${selector} must be visible`)
  assert.equal(await target.isEnabled(), true, `${selector} must be enabled`)
  await target.evaluate(element => element.click())
}
async function fillField(page, selector, text) {
  const field = page.locator(selector)
  assert.equal(await field.isVisible(), true, `${selector} must be visible`)
  assert.equal(await field.isEditable(), true, `${selector} must be editable`)
  await field.evaluate((element, value) => {
    element.focus()
    element.value = value
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
  }, text)
  assert.equal(await field.inputValue(), text, 'The field must contain the exact submitted text')
}
async function screenshot(page, name) {
  const file = path.join(proof, name)
  for (let attempt = 1; ; attempt++) {
    try { await activate(page); await page.screenshot({ path: file, scale: 'css', timeout: 20_000 }); break }
    catch (error) { if (attempt === 3) throw error; log(`Screenshot ${name} attempt ${attempt} failed (${error.name}); refocusing and retrying.`) }
  }
  report.screenshots.push(file)
}
try {
  const startup = await Promise.race([
    once(lines, 'line', { signal: AbortSignal.timeout(30_000) }).then(([line]) => JSON.parse(line)),
    hostExit.then(exit => { throw new Error(`Host exited before startup: ${JSON.stringify(exit)}`) }),
  ])
  url = startup.url; tokenFile = startup.tokenFile; lines.close()
  let a = await launch('replica-a'), b = await launch('replica-b')
  const sa = await current(a.page), sb = await current(b.page)
  assert.notEqual(sa.status.replicaId, sb.status.replicaId); assert.equal(sa.status.docId, sb.status.docId)
  assert.equal(sa.connection, 'disconnected'); assert.equal(sb.connection, 'disconnected')
  log('Two real Electron clients opened: same author/document, distinct persisted replica identities, disconnected.')
  await edit(a.page, 'heading', 'Offline desktop headline')
  await comment(a.page, 'Comment from desktop A while offline')
  await edit(b.page, 'mobile-heading', 'Offline mobile headline')
  await comment(b.page, 'Comment from desktop B while offline')
  assert.ok((await current(a.page)).status.pending >= 3); assert.ok((await current(b.page)).status.pending >= 3)
  assert.match(await a.page.locator('#save-status').innerText(), /pending/)
  await screenshot(a.page, '01-offline-a.png'); await screenshot(b.page, '02-offline-b.png')
  log('UI text edits and anchored comments admitted offline; both clients show saved locally with pending changes.')
  await activate(a.page); await click(a.page, '#connect-host'); await activate(b.page); await click(b.page, '#connect-host')
  const converged = state => state.status.pending === 0 && state.status.sync.kind === 'caught_up' && state.document.annotations.length === 2
  await settle(a.page, converged); await settle(b.page, converged)
  const da = (await current(a.page)).document, db = (await current(b.page)).document
  assert.deepEqual(da, db)
  assert.equal(da.body[0].children.find(n => n.id === 'heading').text, 'Offline desktop headline')
  assert.equal(da.body[1].children.find(n => n.id === 'mobile-heading').text, 'Offline mobile headline')
  assert.equal(new Set(da.annotations.map(a => a.id)).size, 2)
  await a.page.waitForFunction(() => document.querySelector('#save-status').textContent.includes('Published'), undefined, { polling: 100 })
  await b.page.waitForFunction(() => document.querySelector('#comment-list').textContent.includes('Comment from desktop A'), undefined, { polling: 100 })
  await screenshot(a.page, '03-published-a.png'); await screenshot(b.page, '04-published-b.png')
  log('Explicit connect published all changes through real Comb; both documents and both comments converge, with Published status.')
  await activate(a.page); await click(a.page, '#disconnect-host')
  await settle(a.page, state => state.connection === 'disconnected')
  assert.equal((await current(b.page)).connection, 'connected')
  log('Disconnect is per replica; the second client stays connected.')
  await close(a); await close(b)
  a = await launch('replica-a'); b = await launch('replica-b')
  assert.deepEqual((await current(a.page)).document, da); assert.deepEqual((await current(b.page)).document, da)
  assert.equal((await current(a.page)).status.replicaId, sa.status.replicaId); assert.equal((await current(b.page)).status.replicaId, sb.status.replicaId)
  log('Both app processes restart with identical saved documents/comments and their original replica identities.')
  await close(a); await close(b)
  let standalone = await launch('standalone', false)
  await edit(standalone.page, 'heading', 'Standalone saved without repository')
  const local = (await current(standalone.page)).document
  assert.ok((await current(standalone.page)).status.pending > 0)
  await click(standalone.page, '[data-future="comments"]')
  await click(standalone.page, '#connect-host')
  await settle(standalone.page, state => state.status.pending === 0 && state.status.sync.kind === 'caught_up')
  await screenshot(standalone.page, '05-standalone.png')
  await close(standalone)
  standalone = await launch('standalone', false)
  assert.deepEqual((await current(standalone.page)).document, local)
  log('Packaged standalone first launch saves offline, publishes through bundled Comb with its generated local config, and reopens saved edits without repository paths.')
  await close(standalone)
  report.dataChecksPassed = true
} catch (error) {
  report.passed = false; report.error = error.stack
  for (const application of apps) {
    try { const page = await application.firstWindow({ timeout: 1000 }); await screenshot(page, `failure-${report.screenshots.length}.png`); diagnostics += `\nDOM: ${(await page.locator('body').innerText()).slice(-7000)}` } catch {}
  }
  console.error(error); process.exitCode = 1
} finally {
  const shutdownErrors = []
  for (const application of [...apps]) {
    try { await close({ application }) }
    catch (error) { shutdownErrors.push(String(error)); application.process().kill('SIGKILL') }
  }
  lines.close()
  if (host.exitCode === null && host.signalCode === null) host.kill('SIGTERM')
  try {
    report.hostExit = await bounded(hostExit, 70_000, 'External host shutdown exceeded 70 seconds')
    if (report.hostExit.code !== 0 || report.hostExit.signal || report.hostExit.error) shutdownErrors.push(`External host did not exit cleanly: ${JSON.stringify(report.hostExit)}`)
  } catch (error) {
    shutdownErrors.push(String(error)); host.kill('SIGKILL')
    report.hostExit = await bounded(hostExit, 5000, 'External host did not exit after forced stop').catch(error => ({ error: String(error) }))
  }
  report.shutdownErrors = shutdownErrors
  report.passed = report.dataChecksPassed === true && !report.error && shutdownErrors.length === 0
  if (!report.passed) process.exitCode = 1
  else log('All app processes and the external host shut down cleanly; acceptance passed.')
  await writeFile(path.join(proof, 'report.json'), JSON.stringify(report, null, 2))
  await writeFile(path.join(proof, 'diagnostics.log'), diagnostics)
  console.log(`Evidence: ${proof}`)
}
