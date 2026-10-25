import { afterEach, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { metadataToken } from '../src/share/github-app.js'
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('caches Metadata-only repository installation tokens and refreshes before expiration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'share-app-token-'))
  try {
    const file = join(root, 'app.json')
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    await writeFile(file, JSON.stringify({ appId: 42, slug: 'test-app', clientId: 'client', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600 })
    let now = Date.now(), mints = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
      const path = new URL(input).pathname
      if (path === '/app') return Response.json({ permissions: { metadata: 'read' } })
      if (path.endsWith('/installation')) return Response.json({ id: 123, permissions: { metadata: 'read' } })
      expect(path).toBe('/app/installations/123/access_tokens')
      expect(JSON.parse(String(init.body))).toEqual({ permissions: { metadata: 'read' }, repositories: ['repo'] })
      mints++
      return Response.json({ token: 'INSTALLATION_' + mints, expires_at: new Date(now + 3600000).toISOString(), permissions: { metadata: 'read' } })
    })
    expect(await metadataToken('github.com/team/repo', file)).toBe('INSTALLATION_1')
    expect(await metadataToken('team/repo', file)).toBe('INSTALLATION_1')
    expect(mints).toBe(1)
    now += 3540001
    expect(await metadataToken('team/repo', file)).toBe('INSTALLATION_2')
    expect(mints).toBe(2)
  } finally { await rm(root, { recursive: true, force: true }) }
})
