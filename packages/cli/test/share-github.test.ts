import { beforeAll, afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { ready, generateDeviceKeys, deviceStatement, deviceId } from '../src/share/crypto.js'
import { prepareDevice } from '../src/share/client.js'
import { saveSession } from '../src/share/vault.js'
import { verifyDevice, signDevice, DeviceBindingError } from '../src/share/github.js'
import type { ShareConfig } from '../src/share/config.js'
beforeAll(async () => {
  await ready
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
it('authenticates numeric account lookups and caches a verified binding while keeping SSH-key requests credential-free', async () => {
  const root = mkdtempSync(join(tmpdir(), 'share-github-')),
    ssh = join(root, 'ssh')
  try {
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', ssh])
    const config: ShareConfig = {
      version: 1,
      mode: 'self-hosted',
      service: 'http://127.0.0.1:1',
      space: `sp_${randomUUID()}`,
      repo: 'github.com/team/repo',
      encryption: 'e2e-v1'
    }
    const keys = generateDeviceKeys(),
      publicDevice = {
        service: config.service,
        login: 'alice',
        githubId: 42,
        boxPublicKey: keys.boxPublicKey,
        signPublicKey: keys.signPublicKey
      }
    const statement = deviceStatement(config.service, config.space, config.repo, publicDevice),
      device = { ...publicDevice, id: deviceId(statement), signature: signDevice(statement, ssh) }
    vi.stubEnv('FOUNDATION_SHARE_TEST_GITHUB', 'http://127.0.0.1:1111')
    const requests: { path: string; authorization: string | null }[] = []
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
      const path = new URL(String(input)).pathname,
        authorization = new Headers(init?.headers).get('Authorization')
      requests.push({ path, authorization })
      return path === '/user/42'
        ? Response.json({ id: 42, login: 'alice' })
        : new Response(readFileSync(ssh + '.pub', 'utf8'))
    })
    await verifyDevice(config, device, 'LOCAL_TOKEN')
    await verifyDevice(config, device, 'LOCAL_TOKEN')
    expect(requests.filter((r) => r.path === '/user/42')).toEqual([
      { path: '/user/42', authorization: 'Bearer LOCAL_TOKEN' }
    ])
    expect(requests.filter((r) => r.path === '/alice.keys')).toEqual([{ path: '/alice.keys', authorization: null }])
    await verifyDevice(config, device, 'LOCAL_TOKEN', true)
    expect(requests.filter((r) => r.path === '/user/42')).toHaveLength(2)
    await expect(verifyDevice(config, { ...device, signature: 'invalid' }, 'LOCAL_TOKEN')).rejects.toBeInstanceOf(
      DeviceBindingError
    )
    vi.stubEnv('HOME', root)
    saveSession(config.space, {
      device: { device, boxSecretKey: keys.boxSecretKey, signSecretKey: keys.signSecretKey },
      keys: [],
      githubToken: 'LOCAL_TOKEN',
      token: 'scoped',
      expiresAt: Date.now() + 3600000,
      permission: 'write'
    })
    const rotated = join(root, 'rotated')
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', rotated])
    vi.stubGlobal('fetch', async (input: unknown) =>
      new URL(String(input)).pathname.endsWith('.keys')
        ? new Response(readFileSync(rotated + '.pub', 'utf8'))
        : Response.json({ id: 42, login: 'alice' })
    )
    const reattested = await prepareDevice(config, 'LOCAL_TOKEN', rotated, true)
    expect(reattested.device.device.id).toBe(device.id)
    expect(reattested.device.boxSecretKey).toBe(keys.boxSecretKey)
    expect(reattested.device.device.signature).not.toBe(device.signature)
    vi.stubGlobal('fetch', async () => Response.json({ message: 'rate limited' }, { status: 403 }))
    await expect(verifyDevice(config, reattested.device.device, 'LOCAL_TOKEN', true)).rejects.toThrow(
      /cannot resolve.*403/
    )
    vi.stubGlobal('fetch', async (input: unknown) =>
      new URL(String(input)).pathname.endsWith('.keys')
        ? new Response(readFileSync(rotated + '.pub', 'utf8'))
        : Response.json({ id: 42, login: 'alice' })
    )
    await expect(verifyDevice(config, reattested.device.device, 'LOCAL_TOKEN', true)).resolves.toBeUndefined()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
