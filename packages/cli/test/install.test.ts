import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
