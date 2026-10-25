import { beforeAll, describe, expect, it } from 'vitest'
import {
  ready,
  newEpoch,
  generateDeviceKeys,
  wrapKey,
  unwrapKey,
  encrypt,
  decrypt,
  opaqueName,
  type DeviceSecret
} from '../src/share/crypto.js'
import { readShareConfig, serviceUrl } from '../src/share/config.js'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
beforeAll(async () => {
  await ready
})
function device(id: string): DeviceSecret {
  const keys = generateDeviceKeys()
  return {
    device: {
      id,
      service: 'https://share.example',
      login: id,
      githubId: 1,
      boxPublicKey: keys.boxPublicKey,
      signPublicKey: keys.signPublicKey,
      signature: 'ssh signature'
    },
    boxSecretKey: keys.boxSecretKey,
    signSecretKey: keys.signSecretKey
  }
}
describe('client cryptographic boundary', () => {
  it('binds ciphertext to space/feed/epoch/dedup and hides original bytes', () => {
    const key = newEpoch(),
      log = opaqueName('secret document', key.feedKey),
      plain = Buffer.from('private title and change bytes')
    const cipher = encrypt('sp_one', log, 'plaintext hash', plain, key)
    expect(Buffer.from(cipher.hex, 'hex').toString()).not.toContain('private title')
    expect(Buffer.from(decrypt('sp_one', log, cipher.hex, [key]))).toEqual(plain)
    expect(() => decrypt('sp_two', log, cipher.hex, [key])).toThrow()
    expect(() => decrypt('sp_one', 'f'.repeat(64), cipher.hex, [key])).toThrow()
    const record = JSON.parse(Buffer.from(cipher.hex, 'hex').toString())
    record.dedup = '0'.repeat(64)
    expect(() => decrypt('sp_one', log, Buffer.from(JSON.stringify(record)).toString('hex'), [key])).toThrow()
    expect(encrypt('sp_one', log, 'plaintext hash', plain, key).hex).not.toEqual(cipher.hex)
    expect(encrypt('sp_one', log, 'plaintext hash', plain, key).dedup).toEqual(cipher.dedup)
  })
  it('only designated recipient can open a signed wrap; rejects sender/context substitution', () => {
    const alice = device('alice'),
      bob = device('bob'),
      mallory = device('mallory'),
      key = newEpoch()
    const wrap = wrapKey('sp_one', key, bob.device, alice)
    expect(unwrapKey('sp_one', wrap, alice.device, bob)).toEqual(key)
    expect(() => unwrapKey('sp_one', wrap, alice.device, mallory)).toThrow()
    expect(() => unwrapKey('sp_one', wrap, mallory.device, bob)).toThrow()
    expect(() => unwrapKey('sp_two', wrap, alice.device, bob)).toThrow()
  })
  it('removed epoch key cannot decrypt future changes while routing remains stable', () => {
    const old = newEpoch(),
      next = newEpoch(2, old),
      log = opaqueName('document', old.feedKey)
    expect(opaqueName('document', next.feedKey)).toEqual(log)
    const cipher = encrypt('sp_one', log, 'new hash', Buffer.from('after removal'), next)
    expect(() => decrypt('sp_one', log, cipher.hex, [old])).toThrow()
    expect(Buffer.from(decrypt('sp_one', log, cipher.hex, [old, next])).toString()).toBe('after removal')
  })
})
describe('secret-free repo discovery', () => {
  it('defaults absent and git-only files to no transport and rejects downgrade', () => {
    const root = mkdtempSync(join(tmpdir(), 'share-config-'))
    expect(readShareConfig(root)).toBeNull()
    mkdirSync(join(root, '.foundation'))
    writeFileSync(join(root, '.foundation/share.json'), JSON.stringify({ version: 1, mode: 'git-only' }))
    expect(readShareConfig(root)).toBeNull()
    writeFileSync(
      join(root, '.foundation/share.json'),
      JSON.stringify({
        version: 1,
        mode: 'hosted',
        service: 'https://example.com',
        repo: 'github.com/a/b',
        space: 'sp_one',
        encryption: 'none'
      })
    )
    expect(() => readShareConfig(root)).toThrow()
    expect(() => serviceUrl('http://remote.example')).toThrow()
    expect(() => serviceUrl('https://user:secret@example.com')).toThrow()
  })
})

describe('epoch trust and fork alarms', () => {
  it('requires a writer certificate and refuses hidden certified recipients', async () => {
    const { certifyEpoch, verifyEpochCertificate } = await import('../src/share/crypto.js')
    const writer = device('writer'),
      key = newEpoch()
    Object.assign(key, {
      space: 'sp_one',
      repo: 'github.com/team/designs',
      prevEpoch: 0,
      recipients: [{ deviceId: 'writer', login: 'writer', githubId: 1 }]
    })
    certifyEpoch(key, writer)
    expect(() => verifyEpochCertificate(key)).not.toThrow()
    const hidden = structuredClone(key)
    hidden.recipients = []
    expect(() => verifyEpochCertificate(hidden)).toThrow(/hidden/)
    const changed = structuredClone(key)
    changed.key = newEpoch().key
    expect(() => verifyEpochCertificate(changed)).toThrow(/certificate/)
  })
  it('reports a same-epoch key fork separately from authentication failure', () => {
    const key = newEpoch(),
      other = newEpoch(),
      log = opaqueName('doc', key.feedKey)
    const cipher = encrypt('sp_one', log, 'identity', Buffer.from('text'), other)
    expect(() => decrypt('sp_one', log, cipher.hex, [key])).toThrow(/key fork/)
  })
  it('authenticates writer signatures as well as ciphertext', () => {
    const key = newEpoch(),
      writer = device('writer'),
      other = device('other'),
      log = opaqueName('doc', key.feedKey)
    const cipher = encrypt('sp_one', log, 'identity', Buffer.from('text'), key, writer)
    expect(Buffer.from(decrypt('sp_one', log, cipher.hex, [key], writer.device)).toString()).toBe('text')
    expect(() => decrypt('sp_one', log, cipher.hex, [key], other.device)).toThrow(/writer signature/)
  })
  it('recovery opens the sealed key package but a different recovery code cannot', async () => {
    const { recoveryKeypair, recoverEpoch } = await import('../src/share/crypto.js')
    const pair = recoveryKeypair(),
      writer = device('writer'),
      key = newEpoch(),
      wrap = wrapKey('sp_one', key, { id: 'recovery', boxPublicKey: pair.publicKey }, writer)
    expect(recoverEpoch('sp_one', wrap, writer.device, pair.code)).toEqual(key)
    expect(() => recoverEpoch('sp_one', wrap, writer.device, recoveryKeypair().code)).toThrow()
  })
})

it('rejects misspelled public access policy instead of falling back to public readers',()=>{
 const root=mkdtempSync(join(tmpdir(),'share-policy-'));mkdirSync(join(root,'.foundation'))
 writeFileSync(join(root,'.foundation/share.json'),JSON.stringify({version:1,mode:'self-hosted',service:'https://share.example',repo:'github.com/team/repo',space:'sp_one',encryption:'e2e-v1',publicAccess:'collaborater'}))
 expect(()=>readShareConfig(root)).toThrow(/public access policy/)
})
