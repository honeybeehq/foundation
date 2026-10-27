import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { ready, newEpoch, type DeviceSecret } from '../src/share/crypto.js'
import { stateFor } from '../src/share/client.js'
import type { ShareConfig } from '../src/share/config.js'
import type { Session } from '../src/share/vault.js'
beforeAll(async () => {
  await ready
})
afterEach(() => vi.unstubAllGlobals())
const config: ShareConfig = {
  version: 1,
  mode: 'self-hosted',
  service: 'http://127.0.0.1:1',
  space: 'sp_one',
  repo: 'github.com/team/repo',
  encryption: 'e2e-v1',
  recoveryPublicKey: Buffer.alloc(32, 1).toString('base64')
}
function session(): Session {
  return {
    device: {} as DeviceSecret,
    githubToken: 'local-only',
    token: 'scoped-service',
    expiresAt: Date.now() + 3600000,
    permission: 'write',
    keys: [newEpoch(2)]
  }
}
it('rejects rollback on every state response, including one after an accepted response', async () => {
  let epoch = 2
  vi.stubGlobal('fetch', async () =>
    Response.json({ space: config.space, repo: config.repo, epoch, recoveryPublicKey: config.recoveryPublicKey })
  )
  const local = session()
  expect((await stateFor(config, local)).epoch).toBe(2)
  epoch = 1
  await expect(stateFor(config, local)).rejects.toThrow(/rolled back epoch 2 to 1/)
})
it('rejects a recovery substitution before any transport can use the response', async () => {
  vi.stubGlobal('fetch', async () =>
    Response.json({
      space: config.space,
      repo: config.repo,
      epoch: 2,
      recoveryPublicKey: Buffer.alloc(32, 9).toString('base64')
    })
  )
  await expect(stateFor(config, session())).rejects.toThrow(/recovery key differs/)
})
