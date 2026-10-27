import { afterEach, expect, it, vi } from 'vitest'
import { ShareAuth } from '../src/share/auth.js'
import { startShareService } from '../src/share/service.js'
import { metadataToken } from '../src/share/github-app.js'
vi.mock('../src/share/github-app.js', async (original) => ({
  ...await original<typeof import('../src/share/github-app.js')>(),
  metadataToken: vi.fn()
}))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
it('uses renewable repo-scoped App credentials for metadata and permission checks', async () => {
  vi.mocked(metadataToken).mockResolvedValueOnce('INSTALLATION_A').mockResolvedValueOnce('INSTALLATION_B')
  const requests: { path: string; token: string | null }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    requests.push({ path: new URL(url).pathname, token: new Headers(init.headers).get('authorization') })
    return Response.json(requests.length === 1 ? { private: true } : { permission: 'write' })
  })
  const auth = new ShareAuth({ githubAppConfig: '/private/app.json' })
  expect(await auth.permission('github.com/team/repo', 'alice', 'collaborators')).toBe('write')
  expect(metadataToken).toHaveBeenNthCalledWith(1, 'github.com/team/repo', '/private/app.json')
  expect(metadataToken).toHaveBeenNthCalledWith(2, 'github.com/team/repo', '/private/app.json')
  expect(requests.map(r => r.token)).toEqual(['Bearer INSTALLATION_A', 'Bearer INSTALLATION_B'])
})
it('fails closed without leaking credential provider errors', async () => {
  vi.mocked(metadataToken).mockRejectedValue(new Error('SECRET'))
  const journal = vi.spyOn(console, 'error').mockImplementation(() => {})
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  await expect(new ShareAuth({ githubAppConfig: '/private/app.json' }).permission('github.com/team/repo', 'alice', 'collaborators'))
    .rejects.toThrow('GitHub App metadata credential unavailable')
  expect(fetcher).not.toHaveBeenCalled()
  expect(journal).toHaveBeenCalledWith('Share GitHub App: credential provider failed')
  journal.mockRestore()
})
it('rejects relative App config and ambiguous production credential sources before startup', async () => {
  const config = { stateDir: '/unused', comb: { binary: '/unused', args: [] } }
  await expect(startShareService({ ...config, githubAppConfig: 'relative.json' })).rejects.toThrow('absolute path')
  await expect(startShareService({ ...config, githubAppConfig: '/private/app.json', githubPermissionToken: 'STATIC' })).rejects.toThrow('cannot be combined')
  await expect(startShareService({ ...config, githubAppConfig: '/private/app.json', githubApiUrl: 'http://127.0.0.1:1' })).rejects.toThrow('cannot be combined')
})

it('uses the renewable repo credential for the committed descriptor and caches only its verified match', async () => {
  vi.mocked(metadataToken).mockResolvedValue('DESCRIPTOR_INSTALLATION')
  const repo = 'github.com/honeybeehq/test', service = 'https://share.example.test', space = 'sp_' + 'a'.repeat(32)
  const descriptor = { version: 1, mode: 'self-hosted', encryption: 'e2e-v1', repo, service, space }
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer DESCRIPTOR_INSTALLATION')
    return Response.json({ type: 'file', path: '.foundation/share.json', encoding: 'base64', content: Buffer.from(JSON.stringify(descriptor)).toString('base64') })
  })
  vi.stubGlobal('fetch', fetcher)
  const auth = new ShareAuth({ githubAppConfig: '/private/app.json' })
  await auth.descriptor(repo, service, space)
  await auth.descriptor(repo, service, space)
  expect(metadataToken).toHaveBeenCalledWith(repo, '/private/app.json')
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0]![0]).toBe('https://api.github.com/repos/honeybeehq/test/contents/.foundation/share.json')
})
