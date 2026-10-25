import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, symlinkSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readVault, saveSession, type Session } from '../src/share/vault.js'
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
vi.mock('../src/document-lock.js', () => ({ acquireDocumentLock: () => () => {} }))
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks() })
it('selects a private dedicated macOS keychain for reads and writes without changing defaults', () => {
  const root = mkdtempSync(join(tmpdir(), 'share-keychain-'))
  try {
    const file = join(root, 'scratch "quoted".keychain-db')
    writeFileSync(file, 'test keychain placeholder', { mode: 0o600 })
    vi.stubGlobal('process', { ...process, platform: 'darwin' })
    vi.stubEnv('HOME', root)
    vi.stubEnv('FOUNDATION_SHARE_KEYCHAIN', file)
    vi.mocked(execFileSync).mockReturnValue('{"sessions":{}}')
    expect(readVault()).toEqual({ sessions: {} })
    expect(vi.mocked(execFileSync).mock.calls[0][1]).toEqual(['find-generic-password', '-a', root, '-s', 'foundation-share-v1', '-w', file])
    const session = { keys: [], device: { device: { id: 'test' } }, githubToken: 'LOCAL_SECRET' } as unknown as Session
    saveSession('space', session)
    const write = vi.mocked(execFileSync).mock.calls.at(-1)!
    expect(write[1]).toEqual(['-i'])
    const input = String((write[2] as { input: string }).input)
    expect(input).toContain('LOCAL_SECRET')
    expect(input).toContain('scratch \\"quoted\\".keychain-db"\n')
    expect(JSON.stringify(write[1])).not.toContain('LOCAL_SECRET')
    expect(input).not.toMatch(/default-keychain|list-keychains/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
it('refuses relative, symlink and insecure dedicated keychains before invoking security', () => {
  const root = mkdtempSync(join(tmpdir(), 'share-keychain-'))
  try {
    vi.stubGlobal('process', { ...process, platform: 'darwin' })
    vi.stubEnv('FOUNDATION_SHARE_KEYCHAIN', 'relative')
    expect(() => readVault()).toThrow('absolute')
    const file = join(root, 'keychain'), link = join(root, 'link')
    writeFileSync(file, '', { mode: 0o600 }); symlinkSync(file, link)
    vi.stubEnv('FOUNDATION_SHARE_KEYCHAIN', link)
    expect(() => readVault()).toThrow('private regular file')
    chmodSync(file, 0o644); vi.stubEnv('FOUNDATION_SHARE_KEYCHAIN', file)
    expect(() => readVault()).toThrow('private regular file')
    expect(execFileSync).not.toHaveBeenCalled()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
