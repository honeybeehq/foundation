import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
const checks = vi.hoisted(() => ({
  invalid: new Set<string>(),
  removed: new Set<string>(),
  offline: false,
  readers: new Set<string>()
}))
vi.mock('../src/share/github.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/share/github.js')>()
  return {
    ...actual,
    memberAccess: vi.fn(async (_config: unknown, login: string) => {
      if (checks.offline) throw new Error('GitHub unavailable HTTP 403')
      return checks.removed.has(login) ? 'none' : checks.readers.has(login) ? 'read' : 'write'
    }),
    verifyDevice: vi.fn(async (_config: unknown, device: { login: string }) => {
      if (checks.invalid.has(device.login))
        throw new actual.DeviceBindingError('device signature does not match GitHub SSH keys')
    })
  }
})
import {
  ready,
  newEpoch,
  generateDeviceKeys,
  deviceId,
  deviceStatement,
  certifyEpoch,
  wrapKey,
  recoveryKeypair,
  opaqueName,
  encrypt,
  type DeviceSecret,
  type EpochKey
} from '../src/share/crypto.js'
import { maintainKeys, sharingStatus, type ShareState } from '../src/share/client.js'
import { saveSession, sessionFor, type Session } from '../src/share/vault.js'
import { createBridge } from '../src/share/transport.js'
import type { ShareConfig } from '../src/share/config.js'
let root: string, config: ShareConfig, state: ShareState, alice: DeviceSecret, bob: DeviceSecret, dave: DeviceSecret
let readEvents: { seq: string; payload_hex: string }[] = []
let key: EpochKey, writes: Record<string, any>[]
beforeAll(async () => {
  await ready
})
function device(login: string, id: number): DeviceSecret {
  const pair = generateDeviceKeys(),
    d = {
      service: config.service,
      login,
      githubId: id,
      boxPublicKey: pair.boxPublicKey,
      signPublicKey: pair.signPublicKey
    }
  return {
    device: {
      ...d,
      id: deviceId(deviceStatement(config.service, config.space, config.repo, d)),
      signature: 'test SSH binding'
    },
    boxSecretKey: pair.boxSecretKey,
    signSecretKey: pair.signSecretKey
  }
}
function epoch(n: number, devices: DeviceSecret[], previous?: EpochKey): EpochKey {
  const k = newEpoch(n, previous)
  Object.assign(k, {
    space: config.space,
    repo: config.repo,
    prevEpoch: n - 1,
    recipients: devices.map((d) => ({ deviceId: d.device.id, githubId: d.device.githubId, login: d.device.login }))
  })
  certifyEpoch(k, alice)
  return k
}
function local(device: DeviceSecret, keys: EpochKey[], permission = 'write'): Session {
  return {
    device,
    keys,
    githubToken: 'LOCAL_ONLY',
    token: 'scoped',
    expiresAt: Date.now() + 3600000,
    permission,
    membershipCheckedAt: Date.now()
  }
}
beforeEach(() => {
  checks.readers.clear()
  checks.invalid.clear()
  checks.removed.clear()
  checks.offline = false
  root = mkdtempSync(join(tmpdir(), 'share-maintenance-'))
  vi.stubEnv('HOME', root)
  vi.stubEnv('FOUNDATION_REPLICA_STORE', join(root, 'replicas'))
  config = {
    version: 1,
    mode: 'self-hosted',
    service: 'http://127.0.0.1:1',
    space: `sp_${randomUUID().replaceAll('-', '')}`,
    repo: 'github.com/team/repo',
    encryption: 'e2e-v1',
    recoveryPublicKey: recoveryKeypair().publicKey,
    publicAccess: 'collaborators'
  }
  alice = device('alice', 1)
  bob = device('bob', 2)
  dave = device('dave', 3)
  key = epoch(1, [alice, bob])
  writes = []
  readEvents = []
  state = {
    space: config.space,
    repo: config.repo,
    epoch: 1,
    devices: [alice.device, bob.device],
    wraps: [],
    revoked: [],
    recoveryPublicKey: config.recoveryPublicKey
  }
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const path = new URL(String(input)).pathname
    if (path === '/v1/state') return Response.json(state)
    const body = JSON.parse(String(init?.body ?? '{}'))
    if (path === '/v1/keys') {
      writes.push(body)
      state.epoch = body.epoch
      state.wraps.push(...body.wraps)
      state.revoked.push(...(body.revoke ?? []))
      return Response.json(state)
    }
    if (path === '/v1/rpc')
      return Response.json({
        v: 1,
        id: '1',
        op: body.op,
        ok: true,
        log: body.log,
        events: readEvents,
        next_cursor: String(readEvents.length + 1)
      })
    throw new Error(`unexpected service path ${path}`)
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})
it('skips a removed grantor old wrap and accepts a later valid writer epoch with history', async () => {
  const next = epoch(2, [alice, dave], key)
  state.epoch = 2
  state.devices.push(dave.device)
  state.revoked.push(bob.device.id)
  state.wraps = [wrapKey(config.space, key, dave.device, bob), wrapKey(config.space, next, dave.device, alice)]
  checks.removed.add('bob')
  checks.readers.add('dave')
  saveSession(config.space, local(dave, [], 'read'))
  const result = await maintainKeys(config)
  expect(result.session.keys.map((k) => k.epoch)).toEqual([1, 2])
  expect(result.warning).toMatch(/Skipped key epoch 1/)
})
it('excludes a definite invalid binding and rotates without pausing other writers', async () => {
  checks.invalid.add('bob')
  saveSession(config.space, local(alice, [key]))
  const result = await maintainKeys(config)
  expect(result.state.epoch).toBe(2)
  expect(result.state.revoked).toContain(bob.device.id)
  expect(result.warning).toMatch(/bob.*must re-attest/)
  expect(writes[0]?.wraps.some((w: any) => w.deviceId === bob.device.id)).toBe(false)
})
it('does not rotate for a junk device that never received the current key', async () => {
  key = epoch(1, [alice])
  state.devices = [alice.device, dave.device]
  checks.invalid.add('dave')
  saveSession(config.space, local(alice, [key]))
  const result = await maintainKeys(config)
  expect(result.state.epoch).toBe(1)
  expect(result.warning).toMatch(/must re-attest/)
})
it('keeps the grace warning in the human-facing share status', async () => {
  checks.offline = true
  saveSession(config.space, local(alice, [key]))
  const status = await sharingStatus(config)
  expect(status.state).toBe('shared')
  expect(status.reason).toMatch(/Cannot confirm members/)
})
it.each(['pin mismatch', 'expired reader epoch', 'GitHub pause'])(
  'allows existing-key reads during %s while refusing append',
  async (reason) => {
    const session = local(alice, [key], reason === 'expired reader epoch' ? 'read' : 'write')
    if (reason === 'pin mismatch') state.recoveryPublicKey = recoveryKeypair().publicKey
    if (reason === 'expired reader epoch') key.createdAt = Date.now() - 25 * 3600000
    if (reason === 'GitHub pause') {
      checks.offline = true
      session.membershipCheckedAt = Date.now() - 2 * 3600000
    }
    saveSession(config.space, session)
    const bridge = createBridge({ binary: '', args: [], share: config, shareLog: 'document' })
    await expect(bridge.hello()).resolves.toBeUndefined()
    await expect(bridge.request('read', { log: 'logical', cursor: '1' })).resolves.toMatchObject({ events: [] })
    await expect(
      bridge.request('append', { log: 'logical', idempotency_key: 'hash', payload_hex: '00' })
    ).rejects.toThrow()
    bridge.close()
    expect(sessionFor(config.space).keys).toHaveLength(1)
  }
)

it('decrypts an already verified writer while GitHub is unavailable beyond the send grace', async () => {
  checks.offline = true
  const plain = Buffer.from(JSON.stringify({ version: 1, title: 'Readable while sending is paused' }))
  const log = opaqueName('foundation-share-catalogue-v1', key.feedKey),
    identity = createHash('sha256').update(plain).digest('hex')
  readEvents = [{ seq: '1', payload_hex: encrypt(config.space, log, identity, plain, key, bob).hex }]
  const session = local(alice, [key])
  session.membershipCheckedAt = Date.now() - 2 * 3600000
  session.trustedDevices = [bob.device]
  session.writerDevices = [bob.device.id]
  saveSession(config.space, session)
  const bridge = createBridge({ binary: '', args: [], share: config, shareLog: 'foundation-share-catalogue-v1' })
  await bridge.hello()
  const page = await bridge.request('read', { log: 'catalogue', cursor: '1' })
  expect((page.events as { payload_hex: string }[])[0]?.payload_hex).toBe(plain.toString('hex'))
  bridge.close()
})

it('keeps read-only collaborators authorized for key handover and reads', async () => {
  checks.readers.add('dave')
  key = epoch(1, [alice, dave])
  state.devices = [alice.device, dave.device]
  state.wraps = [wrapKey(config.space, key, dave.device, alice)]
  saveSession(config.space, local(dave, [], 'read'))
  const result = await maintainKeys(config)
  expect(result.session.keys).toHaveLength(1)
  expect(result.state.revoked).not.toContain(dave.device.id)
  const bridge = createBridge({ binary: '', args: [], share: config, shareLog: 'document' })
  await expect(bridge.request('read', { log: 'doc', cursor: '1' })).resolves.toMatchObject({ events: [] })
  await expect(bridge.request('append', { log: 'doc', idempotency_key: 'hash', payload_hex: '00' })).rejects.toThrow(
    /read only/
  )
  bridge.close()
})

it('keeps current writer checks when the service rolls back an epoch for reads', async () => {
  checks.readers.add('bob')
  state.epoch = 0
  const plain = Buffer.from(JSON.stringify({ version: 1, title: 'Must reject a read-only writer' })),
    log = opaqueName('foundation-share-catalogue-v1', key.feedKey)
  readEvents = [
    {
      seq: '1',
      payload_hex: encrypt(config.space, log, createHash('sha256').update(plain).digest('hex'), plain, key, bob).hex
    }
  ]
  const session = local(alice, [key])
  session.trustedDevices = [bob.device]
  session.writerDevices = [bob.device.id]
  saveSession(config.space, session)
  const bridge = createBridge({ binary: '', args: [], share: config, shareLog: 'foundation-share-catalogue-v1' })
  await bridge.hello()
  await expect(bridge.request('read', { log: 'catalogue', cursor: '1' })).rejects.toThrow(/not from a repo writer/)
  bridge.close()
})
