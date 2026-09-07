// Explicit integration acceptance against the real packaged host and Comb bridge.
import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'
import path from 'node:path'

const appPath = path.resolve(process.argv[2] ?? 'packages/desktop/release/Foundation-development.app')
const proof = path.resolve(process.argv[3] ?? `packages/desktop/.runtime-downloads/proof-${Date.now()}`)
await mkdir(proof, { recursive: true })
const resources = path.join(appPath, 'Contents/Resources'), executablePath = path.join(appPath, 'Contents/MacOS/Foundation')
const runtime = path.join(resources, 'host')
const config = path.join(proof, 'comb'), objects = path.join(proof, 'objects')
await mkdir(config, { recursive: true, mode: 0o700 }); await mkdir(objects, { recursive: true })
await writeFile(path.join(config, 'config.toml'), `tenant = "foundation_desktop"\ndigest_key = "${randomBytes(32).toString('hex')}"\n[backend]\nkind = "local"\nroot = ${JSON.stringify(objects)}\n`, { mode: 0o600, flag: 'wx' })
const host = spawn(path.join(runtime, 'bin/node'), [path.join(runtime, 'service/service-main.mjs'), '--state-dir', path.join(proof, 'host'), '--comb-bin', path.join(runtime, 'bin/comb'), '--comb-dir', config, '--remote', 'desktop-proof', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] })
let diagnostics = ''; host.stderr.on('data', data => { diagnostics += data })
const lines = createInterface({ input: host.stdout })
const [line] = await once(lines, 'line', { signal: AbortSignal.timeout(30_000) })
const { url, tokenFile } = JSON.parse(line); lines.close()
const apps = new Set()
const owners = new WeakMap()
const report = { appPath, proof, checks: [], screenshots: [] }
const log = message => { report.checks.push(message); console.log(message) }
async function launch(directory, external = true) {
  const application = await electron.launch({ executablePath, args: ['--replica-dir', path.join(proof, directory), '--author', 'user:same-designer', ...(external ? ['--host-url', url, '--host-token-file', tokenFile, '--doc-id', 'desktop-live-proof'] : [])], timeout: 45_000 })
  apps.add(application)
  const page = await application.firstWindow({ timeout: 45_000 })
  owners.set(page, application)
  page.setDefaultTimeout(45_000)
  page.on('pageerror', error => { diagnostics += `\nRenderer: ${error.message}` })
  await page.waitForFunction(() => window.foundationSession?.canEdit(), undefined, { timeout: 45_000 })
  return { application, page }
}
async function activate(page) {
  await owners.get(page).evaluate(({ app, BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); app.focus({ steal: true }) })
  await page.bringToFront()
}
async function close(instance) {
  let timer
  try { await Promise.race([instance.application.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Desktop shutdown exceeded 30 seconds')), 30_000) })]); apps.delete(instance.application) }
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
  await page.locator(`#layer-tree [data-select="${id}"]`).click()
  const field = page.locator('#text-content')
  await field.fill(text); await field.blur()
  await settle(page, state => state.document.body.flatMap(root => root.children).find(n => n.id === id)?.text === text)
}
async function comment(page, text) {
  await activate(page)
  await page.locator('[data-future="comments"]').click()
  await page.locator('#comment-text').fill(text); await page.locator('#post-comment').click()
  await settle(page, state => state.document.annotations.some(a => a.text === text))
}
async function screenshot(page, name) { await activate(page); const file = path.join(proof, name); await page.screenshot({ path: file, scale: 'css' }); report.screenshots.push(file) }
try {
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
  await activate(a.page); await a.page.locator('#connect-host').click(); await activate(b.page); await b.page.locator('#connect-host').click()
  const converged = state => state.status.pending === 0 && state.status.sync.kind === 'caught_up' && state.document.annotations.length === 2
  await settle(a.page, converged); await settle(b.page, converged)
  const da = (await current(a.page)).document, db = (await current(b.page)).document
  assert.deepEqual(da, db)
  assert.equal(da.body[0].children.find(n => n.id === 'heading').text, 'Offline desktop headline')
  assert.equal(da.body[1].children.find(n => n.id === 'mobile-heading').text, 'Offline mobile headline')
  assert.equal(new Set(da.annotations.map(a => a.id)).size, 2)
  await a.page.waitForFunction(() => document.querySelector('#save-status').textContent.includes('Published'))
  await b.page.waitForFunction(() => document.querySelector('#comment-list').textContent.includes('Comment from desktop A'))
  await screenshot(a.page, '03-published-a.png'); await screenshot(b.page, '04-published-b.png')
  log('Explicit connect published all changes through real Comb; both documents and both comments converge, with Published status.')
  await activate(a.page); await a.page.locator('#disconnect-host').click()
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
  await screenshot(standalone.page, '05-standalone.png')
  await close(standalone)
  standalone = await launch('standalone', false)
  assert.deepEqual((await current(standalone.page)).document, local)
  log('Packaged standalone first launch starts bundled Node/host/Comb runtime and reopens saved edits without repository paths.')
  await close(standalone)
  report.passed = true
} catch (error) {
  report.passed = false; report.error = error.stack
  for (const application of apps) {
    try { const page = await application.firstWindow({ timeout: 1000 }); await screenshot(page, `failure-${report.screenshots.length}.png`); diagnostics += `\nDOM: ${(await page.locator('body').innerText()).slice(-7000)}` } catch {}
  }
  console.error(error); process.exitCode = 1
} finally {
  for (const application of apps) { try { await application.evaluate(({ app }) => app.exit()) } catch {} }
  host.kill()
  await writeFile(path.join(proof, 'report.json'), JSON.stringify(report, null, 2))
  await writeFile(path.join(proof, 'diagnostics.log'), diagnostics)
  console.log(`Evidence: ${proof}`)
}
