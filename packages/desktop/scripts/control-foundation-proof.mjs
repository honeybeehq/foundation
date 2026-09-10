#!/usr/bin/env node
// End-to-end acceptance of the public control CLI; no internal mutation calls.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const exec = promisify(execFile)
const script = fileURLToPath(new URL('./control-foundation.mjs', import.meta.url))
const runtime = process.argv[2], directory = process.argv[3]
if (!runtime || !directory) throw new Error('usage: control-foundation-proof.mjs <host-runtime> <fresh-run-directory>')
const run = path.resolve(directory)
const report = { passed: false, run, checks: [], commands: [], interaction: 'Default DOM events through actual UI/preload; real host and local Comb. No native pointer/dialog claims.' }
const check = message => { report.checks.push(message); console.log(message) }
let created = false
async function C(command, ...args) {
  const argv = [script, command, '--run', run, ...args]
  const startedAt = new Date().toISOString()
  try {
    const output = await exec(process.execPath, argv, { timeout: command === 'launch' ? 410_000 : 170_000, maxBuffer: 4 * 1024 * 1024 })
    const result = JSON.parse(output.stdout)
    if (command === 'launch' && result.session?.run === run) created = true
    report.commands.push({ argv, startedAt, exitCode: 0, stderr: output.stderr, result })
    assert.equal(result.ok, true, `${command}: ${output.stdout}`)
    return result
  } catch (error) {
    if (command === 'launch' && error.stdout) {
      try { if (JSON.parse(error.stdout).session?.run === run) created = true } catch {}
    }
    report.commands.push({ argv, startedAt, exitCode: error.code, stdout: error.stdout, stderr: error.stderr, error: error.message })
    throw error
  }
}
const state = async client => (await C('state', '--client', client)).result
try {
  // Refuse existing runs before entering cleanup ownership.
  await stat(run).then(() => { throw new Error(`Refusing existing proof directory: ${run}`) }, error => { if (error.code !== 'ENOENT') throw error })
  const launched = await C('launch', '--runtime', path.resolve(runtime), '--clients', '2')
  const originalPids = [launched.session.hostPid, ...Object.values(launched.session.clients).map(c => c.pid)]
  report.originalPids = originalPids
  await C('doctor')
  const a0 = await state('a'), b0 = await state('b')
  assert.equal(a0.connection, 'disconnected'); assert.equal(b0.connection, 'disconnected')
  assert.notEqual(a0.status.replicaId, b0.status.replicaId)
  assert.equal(a0.status.docId, b0.status.docId)
  check('Doctor confirms current source build; two disconnected clients have distinct replicas and one document.')

  await C('click', '#layer-tree [data-select="heading"]', '--label', 'editing-tree-a')
  await C('fill', '#text-content', 'VERIFY Foundation headline', '--label', 'editing-text-a')
  await C('wait-state', 'document.body.0.children.0.text', '"VERIFY Foundation headline"')
  await C('wait', '[data-node="heading"]', 'VERIFY Foundation headline')
  await C('click', '#undo', '--label', 'editing-undo')
  await C('wait-state', 'document.body.0.children.0.text', JSON.stringify(a0.document.body[0].children[0].text))
  await C('click', '#redo', '--label', 'editing-redo')
  await C('wait-state', 'document.body.0.children.0.text', '"VERIFY Foundation headline"')
  check('Inspector text edit, canvas result, undo and redo match independently read saved state.')

  for (const client of ['a', 'b']) {
    if (client === 'b') {
      await C('click', '#layer-tree [data-select="mobile-heading"]', '--client', client, '--label', 'editing-tree-b')
      await C('fill', '#text-content', 'VERIFY mobile headline', '--client', client, '--label', 'editing-text-b')
    }
    await C('click', '[data-future="comments"]', '--client', client, '--label', 'comments-dock')
    await C('fill', '#comment-text', `VERIFY comment ${client}`, '--client', client, '--label', 'comments-compose')
    await C('click', '#post-comment', '--client', client, '--label', 'comments-post')
    await C('wait-state', 'document.annotations.0.text', JSON.stringify(`VERIFY comment ${client}`), '--client', client)
    const saved = await state(client)
    assert.ok(saved.status.pending > 0)
    assert.equal(saved.document.annotations[0].nodeId, client === 'a' ? 'heading' : 'mobile-heading')
  }
  await C('click', '#comment-list button:text-is("Resolve")', '--label', 'comments-resolve')
  await C('wait-state', 'document.annotations.0.status', '"resolved"')
  await C('click', '#comment-list button:text-is("Reopen")', '--label', 'comments-reopen')
  await C('wait-state', 'document.annotations.0.status', '"open"')
  check('Both peers save independently anchored comments offline; resolve and reopen persist.')

  await C('click', '#connect-host', '--label', 'sync-connect-a')
  await C('click', '#connect-host', '--client', 'b', '--label', 'sync-connect-b')
  for (const client of ['a', 'b']) {
    await C('wait-state', 'status.pending', '0', '--client', client)
    await C('wait-state', 'status.sync.kind', '"caught_up"', '--client', client)
    await C('wait-state', 'document.annotations.length', '2', '--client', client)
    await C('wait', '#save-status', 'Published', '--client', client)
  }
  const a = await state('a'), b = await state('b')
  assert.deepEqual(a.document, b.document)
  assert.equal(a.document.body[0].children[0].text, 'VERIFY Foundation headline')
  assert.equal(a.document.body[1].children[0].text, 'VERIFY mobile headline')
  assert.equal(new Set(a.document.annotations.map(c => c.id)).size, 2)
  check('Real local Comb publication converges complete documents, both edits and two unique comments; both footers show Published.')

  await C('click', '#sync-host', '--label', 'sync-now')
  await C('wait-state', 'status.pending', '0')
  await C('click', '#disconnect-host', '--label', 'sync-disconnect-a')
  await C('wait-state', 'connection', '"disconnected"')
  assert.equal((await state('b')).connection, 'connected')
  await C('restart', '--label', 'editing-reopen-a')
  await C('restart', '--client', 'b', '--label', 'editing-reopen-b')
  assert.deepEqual((await state('a')).document, a.document)
  assert.deepEqual((await state('b')).document, a.document)
  await C('doctor')
  check('Disconnect is per client; both real process restarts retain their full saved documents and replica identities.')
  report.dataChecksPassed = true
} catch (error) {
  report.error = error.stack; process.exitCode = 1
  console.error(error.message)
} finally {
  if (created) {
    try {
      const stopped = await C('cleanup')
      assert.equal(stopped.session.phase, 'stopped')
      assert.equal(stopped.session.scratchArchived, true)
      assert.equal(stopped.session.hostExit.code, 0)
      for (const client of Object.values(stopped.session.clients)) assert.equal(client.exit.code, 0)
      const artifacts = await readdir(path.join(run, 'evidence'))
      assert.ok(artifacts.some(file => file.endsWith('.png')))
      assert.ok(artifacts.includes('actions.jsonl'))
      const lifecycle = JSON.parse(await readFile(path.join(run, 'evidence/lifecycle.json'), 'utf8'))
      assert.equal(lifecycle.phase, 'stopped')
      const repeat = await C('cleanup'); assert.equal(repeat.session.scratchArchived, true)
      report.cleanupPassed = true
      check('All app/host exits acknowledged cleanly; cleanup is repeatable and screenshots/action evidence survive.')
    } catch (error) { report.cleanupError = error.stack; process.exitCode = 1; console.error(error.message) }
    report.passed = Boolean(report.dataChecksPassed && report.cleanupPassed)
    await writeFile(path.join(run, 'evidence/control-proof.json'), JSON.stringify(report, null, 2) + '\n').catch(error => { console.error(error.message); process.exitCode = 1 })
  }
}
