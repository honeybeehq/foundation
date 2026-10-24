import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { activateInstall } from '../src/commands/install.js'
import { captureIo } from '../src/io.js'
let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "foundation install 'quoted'-"))
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
it('keeps a dangling original executable and restores an existing registry with private permissions', () => {
  const bin = join(home, '.local/bin/foundation')
  mkdirSync(join(bin, '..'), { recursive: true }); symlinkSync('/missing-original', bin)
  const registry = join(home, '.hive/gateways/foundation.json')
  mkdirSync(join(registry, '..'), { recursive: true })
  const entry = { name: 'foundation', protocol: 'mcp', shim: { command: bin, args: ['mcp'] }, env: { TEST: 'retained' }, startedAt: new Date().toISOString(), gatewayRev: 1, stateless: true }
  const original = JSON.stringify(entry)
  writeFileSync(registry, original, { mode: 0o600 })
  const io = captureIo(); activateInstall(release('a'.repeat(40)), home, undefined, io)
  expect(readlinkSync(`${bin}.before-foundation-install`)).toBe('/missing-original')
  expect(lstatSync(`${registry}.before-foundation-install`).mode & 0o777).toBe(0o600)
  expect(JSON.parse(readFileSync(registry, 'utf8')).env).toEqual(entry.env)
  execFileSync('/bin/sh', ['-c', JSON.parse(io.out[0]!).rollback])
  expect(readlinkSync(bin)).toBe('/missing-original')
  expect(readFileSync(registry, 'utf8')).toBe(original)
})
it('repeated activation preserves the rollback release and leaves registry bytes unchanged', () => {
  const a = 'a'.repeat(40), b = 'b'.repeat(40)
  activateInstall(release(a), home, undefined, captureIo())
  const registry = join(home, '.hive/gateways/foundation.json')
  const before = readFileSync(registry, 'utf8')
  activateInstall(release(b), home, a, captureIo())
  const io = captureIo(); activateInstall(release(b), home, b, io)
  expect(readFileSync(registry, 'utf8')).toBe(before)
  expect(existsSync(`${registry}.before-foundation-install`)).toBe(false)
  execFileSync('/bin/sh', ['-c', JSON.parse(io.out[0]!).rollback])
  expect(readlinkSync(join(home, '.local/share/foundation/current'))).toBe(join(home, '.local/share/foundation/versions', a))
})
