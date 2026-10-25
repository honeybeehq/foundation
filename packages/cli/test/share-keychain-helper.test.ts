import { afterEach, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readKeychain, writeKeychain } from '../src/share/keychain.js'
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
vi.mock('../src/document-lock.js', () => ({ acquireDocumentLock: () => () => {} }))
const roots: string[] = []
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function setup(native: (args: readonly string[], options: any) => string) {
  const root = mkdtempSync(join(tmpdir(), 'native-keychain-test-')); roots.push(root); vi.stubEnv('HOME', root)
  vi.mocked(execFileSync).mockImplementation(((file: string, args: string[], options: any) => {
    if (file === '/usr/bin/xcrun') { writeFileSync(args.at(-1)!, 'fake compiled helper'); return '' }
    return native([file, ...args], options)
  }) as typeof execFileSync)
  return root
}
it('moves a large raw vault only on stdin, caches compilation and bounds helper calls', () => {
  let stored = ''
  setup((args, options) => {
    expect(options.timeout).toBe(10000)
    expect(options.env).toBeUndefined()
    if (args[1] === 'set') { stored = options.input; expect(args.join(' ')).not.toContain('SECRET'); return '' }
    return stored
  })
  const vault = JSON.stringify({ sessions: { test: { secret: 'SECRET'.repeat(4096) } } })
  writeKeychain(vault, '/private/keychain')
  expect(readKeychain('/private/keychain')).toBe(vault)
  expect(vi.mocked(execFileSync).mock.calls.filter(c => c[0] === '/usr/bin/xcrun')).toHaveLength(1)
})
it('maps only missing native and missing legacy items to an empty vault', () => {
  setup(() => { throw Object.assign(new Error('not found'), { status: 44 }) })
  expect(readKeychain()).toBeUndefined()
  expect(vi.mocked(execFileSync).mock.calls.at(-1)?.[0]).toBe('/usr/bin/security')
})
it('fails closed on helper timeout and never reads legacy data on native errors', () => {
  setup(() => { throw Object.assign(new Error('SECRET'), { code: 'ETIMEDOUT' }) })
  expect(() => readKeychain()).toThrow('cannot read Foundation sharing keys')
  expect(vi.mocked(execFileSync).mock.calls.some(c => c[0] === '/usr/bin/security')).toBe(false)
  expect(() => writeKeychain('SECRET')).toThrow('cannot write Foundation sharing keys')
})
it('refuses a corrupted cached helper before running it', () => {
  const root = setup(() => '{}')
  expect(readKeychain()).toBe('{}')
  const directory = join(root, '.foundation/share/helpers')
  const cache = readdirSync(directory).find(name => name.startsWith('keychain-'))!
  const binary = join(directory, cache, 'helper')
  writeFileSync(binary, 'tampered')
  const count = vi.mocked(execFileSync).mock.calls.length
  expect(() => readKeychain()).toThrow('hash mismatch')
  expect(vi.mocked(execFileSync).mock.calls).toHaveLength(count)
})
it('copies a missing native vault from legacy reads and verifies it before returning', () => {
  let stored: string | undefined
  const legacy = JSON.stringify({ sessions: { test: { value: 'SECRET'.repeat(4096) } } })
  setup((args, options) => {
    if (args[0] === '/usr/bin/security') return legacy
    if (args[1] === 'set') { stored = options.input; return '' }
    if (stored === undefined) throw Object.assign(new Error('missing'), { status: 44 })
    return stored
  })
  expect(readKeychain('/private/keychain')).toBe(legacy)
  const legacyCall = vi.mocked(execFileSync).mock.calls.find(c => c[0] === '/usr/bin/security')!
  expect(legacyCall[1]).toContain('find-generic-password')
  expect(legacyCall[1]).not.toContain('-i')
  expect(legacyCall[1]).not.toContain('delete-generic-password')
})

it('refuses to resurrect a stale legacy vault after the native item disappears', () => {
  let stored: string | undefined
  let legacyReads = 0
  setup((args, options) => {
    if (args[0] === '/usr/bin/security') { legacyReads++; return '{"sessions":{}}' }
    if (args[1] === 'set') { stored = options.input; return '' }
    if (stored === undefined) throw Object.assign(new Error('missing'), { status: 44 })
    return stored
  })
  expect(readKeychain()).toBe('{"sessions":{}}')
  stored = undefined
  expect(() => readKeychain()).toThrow('native share Keychain item missing after migration')
  expect(legacyReads).toBe(1)
})
