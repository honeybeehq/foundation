import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, symlinkSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readKeychain, writeKeychain } from '../src/share/keychain.js'
import { readVault, saveSession, type Session } from '../src/share/vault.js'
vi.mock('../src/share/keychain.js', () => ({ readKeychain: vi.fn(), writeKeychain: vi.fn() }))
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
    vi.mocked(readKeychain).mockReturnValue('{"sessions":{}}')
    expect(readVault()).toEqual({ sessions: {} })
    expect(readKeychain).toHaveBeenCalledWith(file)
    const session = { keys: [], device: { device: { id: 'test' } }, githubToken: 'LOCAL_SECRET'.repeat(2048) } as unknown as Session
    saveSession('space', session)
    const write = vi.mocked(writeKeychain).mock.calls.at(-1)!
    expect(write[1]).toBe(file)
    expect(write[0].length).toBeGreaterThan(16384)
    expect(JSON.parse(write[0]).sessions.space.githubToken).toBe(session.githubToken)
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
    expect(readKeychain).not.toHaveBeenCalled()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
