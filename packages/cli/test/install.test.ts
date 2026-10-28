import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { activateInstall, runInstall } from '../src/commands/install.js'
import { captureIo } from '../src/io.js'
let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "foundation install 'quoted'-"))
  vi.stubEnv('HOME', home)
  vi.stubEnv('FOUNDATION_GATEWAY_DIR', join(home, '.hive/gateways'))
})
afterEach(() => { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) })
function release(sha: string): string {
  const target = join(home, '.local/share/foundation/versions', sha)
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'foundation-install.json'), JSON.stringify({ runtime: { sourceSha: sha } }))
  writeFileSync(join(target, 'foundation'), '#!/bin/sh\n', { mode: 0o755 })
  return target
}
it('keeps a dangling original executable and restores an existing registry with private permissions', async () => {
  const bin = join(home, '.local/bin/foundation')
  mkdirSync(join(bin, '..'), { recursive: true }); symlinkSync('/missing-original', bin)
  const registry = join(home, '.hive/gateways/foundation.json')
  mkdirSync(join(registry, '..'), { recursive: true })
  const entry = { name: 'foundation', protocol: 'mcp', shim: { command: bin, args: ['mcp'] }, env: { TEST: 'retained' }, startedAt: new Date().toISOString(), gatewayRev: 1, stateless: true }
  const original = JSON.stringify(entry)
  writeFileSync(registry, original, { mode: 0o600 })
  const io = captureIo(); activateInstall(release('a'.repeat(40)), home, undefined, io)
  expect(readlinkSync(`${bin}.before-foundation-install`)).toBe('/missing-original')
  expect(lstatSync(join(home, '.local/share/foundation/rollback.json')).mode & 0o777).toBe(0o600)
  expect(JSON.parse(readFileSync(registry, 'utf8')).env).toEqual(entry.env)
  expect(await runInstall(['--rollback'], captureIo())).toBe(0)
  expect(readlinkSync(bin)).toBe('/missing-original')
  expect(readFileSync(registry, 'utf8')).toBe(original)
})
it('repeated activation preserves the rollback release and leaves registry bytes unchanged', async () => {
  const a = 'a'.repeat(40), b = 'b'.repeat(40)
  activateInstall(release(a), home, undefined, captureIo())
  const registry = join(home, '.hive/gateways/foundation.json')
  const before = readFileSync(registry, 'utf8')
  activateInstall(release(b), home, a, captureIo())
  const io = captureIo(); activateInstall(release(b), home, b, io)
  expect(readFileSync(registry, 'utf8')).toBe(before)
  expect(existsSync(`${registry}.before-foundation-install`)).toBe(false)
  expect(await runInstall(['--rollback'], captureIo())).toBe(0)
  expect(readlinkSync(join(home, '.local/share/foundation/current'))).toBe(join(home, '.local/share/foundation/versions', a))
})
it('plans an install without creating a HOME directory or running a build', async () => {
  const emptyHome = join(home, 'absent-home')
  vi.stubEnv('HOME', emptyHome)
  vi.stubEnv('FOUNDATION_GATEWAY_DIR', join(emptyHome, '.hive/gateways'))
  const io = captureIo()
  expect(await runInstall(['--from', process.cwd(), '--dry-run'], io)).toBe(0)
  const plan = JSON.parse(io.out[0]!)
  expect(plan.dryRun).toBe(true)
  expect(plan.node.path).toBe(process.execPath)
  expect(plan.changes).toHaveLength(4)
  expect(existsSync(emptyHome)).toBe(false)
})
it('plans rollback without changing files and restores an absent initial setup', async () => {
  activateInstall(release('a'.repeat(40)), home, undefined, captureIo())
  const current = join(home, '.local/share/foundation/current')
  expect(await runInstall(['--rollback', '--dry-run'], captureIo())).toBe(0)
  expect(existsSync(current)).toBe(true)
  expect(await runInstall(['--rollback'], captureIo())).toBe(0)
  expect(existsSync(current)).toBe(false)
  expect(existsSync(join(home, '.local/bin/foundation'))).toBe(false)
  expect(existsSync(join(home, '.hive/gateways/foundation.json'))).toBe(false)
  expect(await runInstall(['--rollback'], captureIo())).toBe(1)
})
it('refuses to roll back a release switched by another actor', async () => {
  activateInstall(release('a'.repeat(40)), home, undefined, captureIo())
  const current = join(home, '.local/share/foundation/current')
  rmSync(current); symlinkSync(release('b'.repeat(40)), current)
  expect(await runInstall(['--rollback'], captureIo())).toBe(1)
  expect(readlinkSync(current)).toContain('b'.repeat(40))
})
it('runs the printed rollback without the new release launcher and restores original file bytes', () => {
  const bin = join(home, '.local/bin/foundation')
  mkdirSync(join(bin, '..'), { recursive: true })
  writeFileSync(bin, 'original executable', { mode: 0o751 })
  const target = release('a'.repeat(40)), io = captureIo()
  activateInstall(target, home, undefined, io)
  rmSync(join(target, 'foundation'))
  execFileSync('/bin/sh', ['-c', JSON.parse(io.out[0]!).rollback])
  expect(readFileSync(bin, 'utf8')).toBe('original executable')
  expect(lstatSync(bin).mode & 0o777).toBe(0o751)
})
it('keeps current on the new release until rollback completes and allows retry after failure', async () => {
  const a = 'a'.repeat(40), b = 'b'.repeat(40)
  activateInstall(release(a), home, undefined, captureIo())
  const registry = join(home, '.hive/gateways/foundation.json')
  const original = readFileSync(registry, 'utf8')
  activateInstall(release(b), home, a, captureIo())
  chmodSync(join(registry, '..'), 0o555)
  try {
    expect(await runInstall(['--rollback'], captureIo())).toBe(1)
    expect(readlinkSync(join(home, '.local/share/foundation/current'))).toContain(b)
  } finally { chmodSync(join(registry, '..'), 0o755) }
  expect(await runInstall(['--rollback'], captureIo())).toBe(0)
  expect(readlinkSync(join(home, '.local/share/foundation/current'))).toContain(a)
  expect(readFileSync(registry, 'utf8')).toBe(original)
})
it('refuses to overwrite a gateway edited after activation', async () => {
  activateInstall(release('a'.repeat(40)), home, undefined, captureIo())
  const registry = join(home, '.hive/gateways/foundation.json')
  writeFileSync(registry, 'changed by owner')
  expect(await runInstall(['--rollback'], captureIo())).toBe(1)
  expect(readFileSync(registry, 'utf8')).toBe('changed by owner')
})

it('reports install state outside the four restored paths in plans and activation output', async () => {
  const io = captureIo()
  expect(await runInstall(['--from', process.cwd(), '--dry-run'], io)).toBe(0)
  const plan = JSON.parse(io.out[0]!)
  const activated = captureIo()
  activateInstall(release('a'.repeat(40)), home, undefined, activated)
  expect(JSON.parse(activated.out[0]!).stateOutsideRollback).toEqual(plan.stateOutsideRollback)
  expect(plan.stateOutsideRollback.map((entry: {path:string}) => entry.path)).toEqual([
    '.local/share/foundation/versions/', '.local/share/foundation/rollbacks/',
    '.local/share/foundation/rollback.json', '.local/share/foundation/rollback-restored.json',
    '.local/share/foundation/rollback-active', '.local/bin/foundation.before-foundation-install',
    '.local/share/foundation/install.lock', '.foundation/machine-id',
  ].map(path => join(home, path)))
})
