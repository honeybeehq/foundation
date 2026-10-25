import sodium from 'libsodium-wrappers-sumo'
import { createHash } from 'node:crypto'
export const ready = sodium.ready
export const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')
export function unb64(text: string, size?: number): Uint8Array {
  if (typeof text !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text))
    throw new Error('invalid base64')
  const bytes = Buffer.from(text, 'base64')
  if (size !== undefined && bytes.length !== size) throw new Error('invalid key length')
  return bytes
}
export interface Device {
  service: string
  id: string
  login: string
  githubId: number
  boxPublicKey: string
  signPublicKey: string
  signature: string
}
export interface DeviceSecret {
  device: Device
  boxSecretKey: string
  signSecretKey: string
}
export interface Recipient {
  deviceId: string
  login: string
  githubId: number
}
export interface EpochKey {
  createdAt?: number
  issuer?: Device
  certificate?: string
  epochRecipients?: Recipient[]
  space?: string
  repo?: string
  prevEpoch?: number
  recipients?: Recipient[]
  epoch: number
  key: string
  feedKey: string
  dedupKey: string
  history?: EpochKey[]
}
export interface WrappedKey {
  epoch: number
  deviceId: string
  senderId: string
  box: string
  signature: string
}
export function deviceStatement(
  service: string,
  space: string,
  repo: string,
  device: Pick<Device, 'login' | 'githubId' | 'boxPublicKey' | 'signPublicKey'>
): string {
  return JSON.stringify([
    'foundation-device-v1',
    service,
    space,
    repo,
    device.login,
    device.githubId,
    device.boxPublicKey,
    device.signPublicKey
  ])
}
export function deviceId(statement: string): string {
  return createHash('sha256').update(statement).digest('hex')
}
export function generateDeviceKeys(): {
  boxPublicKey: string
  boxSecretKey: string
  signPublicKey: string
  signSecretKey: string
} {
  const box = sodium.crypto_box_keypair(),
    sign = sodium.crypto_sign_keypair()
  return {
    boxPublicKey: b64(box.publicKey),
    boxSecretKey: b64(box.privateKey),
    signPublicKey: b64(sign.publicKey),
    signSecretKey: b64(sign.privateKey)
  }
}
export function newEpoch(epoch = 1, previous?: EpochKey): EpochKey {
  return {
    epoch,
    createdAt: Date.now(),
    ...(previous
      ? { space: previous.space, repo: previous.repo, prevEpoch: previous.epoch, recipients: previous.recipients }
      : {}),
    key: b64(sodium.randombytes_buf(32)),
    feedKey: previous?.feedKey ?? b64(sodium.randombytes_buf(32)),
    dedupKey: b64(sodium.randombytes_buf(32)),
    ...(previous
      ? {
          history: [
            ...(previous.history ?? []),
            { epoch: previous.epoch, key: previous.key, feedKey: previous.feedKey, dedupKey: previous.dedupKey }
          ]
        }
      : {})
  }
}
export function validateEpoch(value: EpochKey): EpochKey {
  if (!value || !Number.isSafeInteger(value.epoch) || value.epoch < 1) throw new Error('invalid key epoch')
  for (const key of [value.key, value.feedKey, value.dedupKey]) unb64(key, 32)
  if (value.history) {
    if (!Array.isArray(value.history) || value.history.length > 1000) throw new Error('invalid key history')
    const seen = new Set<number>()
    for (const old of value.history) {
      if (old.history || old.epoch >= value.epoch || seen.has(old.epoch)) throw new Error('invalid key history')
      validateEpoch(old)
      seen.add(old.epoch)
      if (old.feedKey !== value.feedKey) throw new Error('routing key mismatch')
    }
  }
  if (
    value.recipients &&
    (!Array.isArray(value.recipients) ||
      value.recipients.length > 1000 ||
      value.recipients.some(
        (r) =>
          !r ||
          !Number.isSafeInteger(r.githubId) ||
          !/^[-A-Za-z0-9]+$/.test(r.login) ||
          !/^[-a-zA-Z0-9]+$/.test(r.deviceId)
      ))
  )
    throw new Error('invalid epoch recipients')
  return value
}
export function opaqueName(name: string, key: string): string {
  return Buffer.from(sodium.crypto_generichash(32, name, unb64(key, 32))).toString('hex')
}
function wrapStatement(space: string, wrap: Omit<WrappedKey, 'signature'>): string {
  return JSON.stringify([space, wrap.epoch, wrap.deviceId, wrap.senderId, wrap.box])
}
export function wrapKey(
  space: string,
  key: EpochKey,
  recipient: Pick<Device, 'id' | 'boxPublicKey'>,
  sender: DeviceSecret
): WrappedKey {
  const wrap = {
    epoch: key.epoch,
    deviceId: recipient.id,
    senderId: sender.device.id,
    box: b64(sodium.crypto_box_seal(JSON.stringify(key), unb64(recipient.boxPublicKey, 32)))
  }
  return {
    ...wrap,
    signature: b64(sodium.crypto_sign_detached(wrapStatement(space, wrap), unb64(sender.signSecretKey, 64)))
  }
}
export function unwrapKey(space: string, wrap: WrappedKey, sender: Device, recipient: DeviceSecret): EpochKey {
  if (
    wrap.senderId !== sender.id ||
    wrap.deviceId !== recipient.device.id ||
    !sodium.crypto_sign_verify_detached(
      unb64(wrap.signature, 64),
      wrapStatement(space, wrap),
      unb64(sender.signPublicKey, 32)
    )
  )
    throw new Error('invalid wrapped-key signature')
  const bytes = sodium.crypto_box_seal_open(
    unb64(wrap.box),
    unb64(recipient.device.boxPublicKey, 32),
    unb64(recipient.boxSecretKey, 32)
  )
  const key = validateEpoch(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  if (key.epoch !== wrap.epoch) throw new Error('wrapped-key epoch mismatch')
  return key
}
export interface CipherRecord {
  v: 1
  epoch: number
  keyId: string
  dedup: string
  nonce: string
  ciphertext: string
  senderId?: string
  signature?: string
}
export function keyId(key: EpochKey): string {
  return Buffer.from(sodium.crypto_generichash(16, JSON.stringify(['foundation-keyid-v1', key.key]), null)).toString(
    'hex'
  )
}
function aad(space: string, log: string, epoch: number, dedup: string, id: string): string {
  return JSON.stringify(['foundation-e2e-v1', space, log, epoch, dedup, id])
}
function recordStatement(space: string, log: string, r: CipherRecord): string {
  return JSON.stringify([
    'foundation-record-v1',
    space,
    log,
    r.epoch,
    r.keyId,
    r.dedup,
    r.nonce,
    r.ciphertext,
    r.senderId
  ])
}
export function encrypt(
  space: string,
  log: string,
  identity: string,
  plain: Uint8Array,
  key: EpochKey,
  sender?: DeviceSecret
): { hex: string; dedup: string } {
  const nonce = sodium.randombytes_buf(24),
    dedup = opaqueName(JSON.stringify(['dedup-v1', log, identity]), key.dedupKey)
  const record: CipherRecord = {
    v: 1,
    epoch: key.epoch,
    keyId: keyId(key),
    dedup,
    nonce: b64(nonce),
    ciphertext: b64(
      sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        plain,
        aad(space, log, key.epoch, dedup, keyId(key)),
        null,
        nonce,
        unb64(key.key, 32)
      )
    )
  }
  if (sender) {
    record.senderId = sender.device.id
    record.signature = b64(
      sodium.crypto_sign_detached(recordStatement(space, log, record), unb64(sender.signSecretKey, 64))
    )
  }
  return { hex: Buffer.from(JSON.stringify(record)).toString('hex'), dedup }
}
export function decrypt(space: string, log: string, hex: string, keys: EpochKey[], sender?: Device): Uint8Array {
  if (!/^(?:[a-f0-9]{2})+$/.test(hex) || hex.length > 2097152) throw new Error('invalid encrypted payload')
  const r = JSON.parse(Buffer.from(hex, 'hex').toString('utf8')) as CipherRecord
  if (r.v !== 1 || !/^[a-f0-9]{64}$/.test(r.dedup)) throw new Error('invalid encrypted record')
  const key = keys.find((k) => k.epoch === r.epoch)
  if (!key) throw new Error(`waiting for key epoch ${r.epoch}`)
  if (r.keyId !== keyId(key)) throw new Error(`key fork at epoch ${r.epoch}`)
  if (
    sender &&
    (r.senderId !== sender.id ||
      !r.signature ||
      !sodium.crypto_sign_verify_detached(
        unb64(r.signature, 64),
        recordStatement(space, log, r),
        unb64(sender.signPublicKey, 32)
      ))
  )
    throw new Error('invalid writer signature')
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    unb64(r.ciphertext),
    aad(space, log, r.epoch, r.dedup, r.keyId),
    unb64(r.nonce, 24),
    unb64(key.key, 32)
  )
}
export function recoveryKeypair(): { code: string; publicKey: string } {
  const pair = sodium.crypto_box_keypair()
  return { code: b64(pair.privateKey), publicKey: b64(pair.publicKey) }
}

function epochStatement(key: EpochKey): string {
  return JSON.stringify([
    'foundation-epoch-v1',
    key.space,
    key.repo,
    key.epoch,
    key.prevEpoch,
    key.createdAt,
    keyId(key),
    key.feedKey,
    key.dedupKey,
    key.epochRecipients
  ])
}
export function certifyEpoch(key: EpochKey, issuer: DeviceSecret): void {
  key.issuer = issuer.device
  key.epochRecipients = key.recipients
  key.certificate = b64(sodium.crypto_sign_detached(epochStatement(key), unb64(issuer.signSecretKey, 64)))
}
export function verifyEpochCertificate(key: EpochKey): void {
  if (
    key.prevEpoch !== key.epoch - 1 ||
    !Number.isSafeInteger(key.createdAt) ||
    key.createdAt! > Date.now() + 300000 ||
    !key.issuer ||
    !key.certificate ||
    !key.epochRecipients ||
    !sodium.crypto_sign_verify_detached(
      unb64(key.certificate, 64),
      epochStatement(key),
      unb64(key.issuer.signPublicKey, 32)
    )
  )
    throw new Error('invalid epoch writer certificate')
  for (const recipient of key.epochRecipients)
    if (
      !key.recipients?.some(
        (r) => r.deviceId === recipient.deviceId && r.githubId === recipient.githubId && r.login === recipient.login
      )
    )
      throw new Error('epoch recipient hidden')
}
export function authProof(service: string, space: string, challenge: string, device: DeviceSecret): string {
  return b64(
    sodium.crypto_sign_detached(
      JSON.stringify(['foundation-auth-v1', service, space, device.device.id, challenge]),
      unb64(device.signSecretKey, 64)
    )
  )
}
export function recoverEpoch(space: string, wrap: WrappedKey, sender: Device, code: string): EpochKey {
  const secret = unb64(code.trim(), 32),
    publicKey = b64(sodium.crypto_scalarmult_base(secret))
  const recipient: DeviceSecret = {
    device: {
      id: 'recovery',
      service: '',
      login: '',
      githubId: 0,
      boxPublicKey: publicKey,
      signPublicKey: '',
      signature: ''
    },
    boxSecretKey: b64(secret),
    signSecretKey: ''
  }
  return unwrapKey(space, wrap, sender, recipient)
}
