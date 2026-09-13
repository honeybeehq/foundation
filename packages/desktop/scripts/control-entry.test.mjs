import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const script = fileURLToPath(new URL('./control-foundation.mjs', import.meta.url))

test('help runs through a real symlink without launching a session', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'foundation-control-entry-'))
  const link = path.join(directory, 'control.mjs')
  await symlink(script, link)
  const direct = spawnSync(process.execPath, [script, 'help'], { encoding: 'utf8' })
  const linked = spawnSync(process.execPath, [link, 'help'], { encoding: 'utf8' })
  assert.equal(direct.status, 0)
  assert.equal(linked.status, 0)
  assert.equal(linked.stdout, direct.stdout)
  assert.equal(JSON.parse(linked.stdout).ok, true)
})

test('importing the control module does not execute its CLI', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'foundation-control-import-'))
  const importer = path.join(directory, 'import.mjs')
  await writeFile(importer, `await import(${JSON.stringify(new URL('./control-foundation.mjs', import.meta.url).href)}); console.log('import-only')\n`)
  const result = spawnSync(process.execPath, [importer, 'help'], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.equal(result.stdout, 'import-only\n')
  assert.equal(result.stderr, '')
})
