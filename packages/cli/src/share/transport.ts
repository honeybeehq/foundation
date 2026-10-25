import { createHash } from 'node:crypto'
import { decodeBlob } from '../../../engine/src/chain/blob.js'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { writeAtomic } from '../disk.js'
import { replicaRoot, type LiveDesign } from '../sync-store.js'
import { CombBridge, type Frame } from '../sync/bridge.js'
import type { CombConfig } from '../sync/daemon.js'
import { readShareConfig, findShareRoot, type ShareConfig } from './config.js'
import { authorizedSession, api, maintainKeys, stateFor } from './client.js'
import { encrypt, decrypt, opaqueName, ready } from './crypto.js'
import { memberAccess, verifyDevice } from './github.js'
import { sessionFor, readVault, saveSession } from './vault.js'
export interface Bridge {
  hello(): Promise<void>
  request(op: string, fields?: Frame): Promise<Frame>
  close(): void
  finish(): Promise<void>
}
export function configForDesign(config: CombConfig, design: LiveDesign): CombConfig {
  if (config.binary) return config // explicitly configured development transport wins
  const root = design.repoRoot ?? findShareRoot(dirname(design.file)),
    share = root ? readShareConfig(root) : null
  if (!share) throw new Error('Live sharing: git-only')
  return { ...config, share, shareLog: JSON.stringify(['foundation-share-document-v1', design.docId]) }
}
const maintenance = new Map<string, { at: number; promise: Promise<void>; done: boolean }>()
export async function refreshKeys(config: ShareConfig): Promise<void> {
  const old = maintenance.get(config.space)
  if (old && (!old.done || Date.now() - old.at < 2000)) return old.promise
  const entry = { at: Date.now(), done: false, promise: Promise.resolve() }
  const promise = maintainKeys(config)
    .then(({ session, state, warning }) => {
      const status = session.keys.some((k) => k.epoch === state.epoch) ? 'shared' : 'waiting for key'
      recordShareStatus(
        config,
        status,
        status === 'waiting for key' ? "Waiting for a teammate's machine to share the key" : (warning ?? null)
      )
    })
    .catch((error) => {
      recordShareStatus(
        config,
        String(error).includes('no access')
          ? 'no access'
          : String(error).includes('Sign in')
            ? 'sign in'
            : 'unavailable',
        String(error)
      )
      throw error
    })
    .finally(() => {
      entry.done = true
      entry.at = Date.now()
    })
  entry.promise = promise
  maintenance.set(config.space, entry)
  return promise
}
export function recordShareStatus(config: ShareConfig, state: string, reason: string | null): void {
  const dir = join(replicaRoot(), 'sharing')
  mkdirSync(dir, { recursive: true })
  writeAtomic(
    join(dir, `${config.space}.json`),
    JSON.stringify({ state, reason, at: new Date().toISOString(), repo: config.repo })
  )
}
class ShareBridge implements Bridge {
  private closed = false
  constructor(
    private config: ShareConfig,
    private address?: string
  ) {}
  async hello(): Promise<void> {
    await ready
    await prepareSharingRead(this.config)
    const session = sessionFor(this.config.space)
    if (!session.keys.length) throw new Error("Waiting for a teammate's machine to share the key")
  }
  close(): void {
    this.closed = true
  }
  async finish(): Promise<void> {
    this.close()
  }
  async request(op: string, fields: Frame = {}): Promise<Frame> {
    if (this.closed) throw new Error('share transport closed')
    await ready
    const publishing = op === 'append' || op === 'hint'
    if (publishing) await refreshKeys(this.config)
    else await prepareSharingRead(this.config)
    const session = await authorizedSession(this.config),
      state = await stateFor(this.config, session, !publishing)
    const key = session.keys.find((key) => key.epoch === state.epoch) ?? (!publishing ? session.keys.at(-1) : undefined)
    if (!key) {
      await refreshKeys(this.config)
      throw new Error(`waiting for key epoch ${state.epoch}`)
    }
    const logical = String(fields.log),
      log = opaqueName(this.address ?? logical, key.feedKey)
    const request: Frame = { ...fields, space: this.config.space, op, log }
    if (publishing) {
      if (session.rotationRequired || Date.now() - (key.createdAt ?? 0) >= 24 * 60 * 60 * 1000)
        throw new Error('rotation required before sending')
      if (!session.membershipCheckedAt || Date.now() - session.membershipCheckedAt >= 3600000)
        throw new Error(
          `Live sharing paused: cannot confirm members with GitHub since ${session.membershipCheckedAt ? new Date(session.membershipCheckedAt).toISOString() : 'startup'}`
        )

      if (Buffer.byteLength(String(fields.payload_hex), 'hex') > 350000)
        throw new Error('change exceeds encrypted sharing limit (350000 bytes)')
      if (session.permission !== 'write') throw new Error('Live sharing: read only')
      const encrypted = encrypt(
        this.config.space,
        log,
        String(fields.idempotency_key),
        Buffer.from(String(fields.payload_hex), 'hex'),
        key,
        session.device
      )
      Object.assign(request, { idempotency_key: encrypted.dedup, payload_hex: encrypted.hex, epoch: key.epoch })
    }
    const response = await api<Frame>(this.config, 'rpc', session.token, request, op === 'hint' ? 2000 : 35000)
    if (response.log !== undefined && response.log !== log) throw new Error('share response feed mismatch')
    if (Array.isArray(response.events))
      response.events = await Promise.all(
        response.events.map(async (event) => {
          const value = event as Frame
          return {
            ...value,
            payload_hex: Buffer.from(
              await verifiedDecrypt(
                this.config,
                log,
                String(value.payload_hex),
                state,
                session,
                this.address === 'foundation-share-catalogue-v1'
              )
            ).toString('hex')
          }
        })
      )
    return { ...response, ...(response.log !== undefined ? { log: logical } : {}) }
  }
}
export function createBridge(config: CombConfig): Bridge {
  return config.share ? new ShareBridge(config.share, config.shareLog) : new CombBridge(config.binary, config.args)
}
/** Advisory live ciphertext receipt. Durable cursors are never changed here. */
export async function shareRelay(
  config: ShareConfig,
  logical: string,
  signal: AbortSignal,
  onBytes: (bytes: Uint8Array) => void
): Promise<void> {
  while (!signal.aborted) {
    try {
      await ready
      await prepareSharingRead(config)
      const session = await authorizedSession(config),
        key = session.keys.at(-1)
      if (!key) throw new Error('waiting for key')
      const log = opaqueName(logical, key.feedKey)
      const response = await fetch(`${config.service}/v1/relay?space=${config.space}`, {
        headers: { Authorization: `Bearer ${session.token}` },
        signal,
        redirect: 'error'
      })
      if (!response.ok || !response.body) throw new Error('relay unavailable')
      const reader = response.body.getReader(),
        decoder = new TextDecoder()
      let buffer = ''
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          if (buffer.length > 2097152) throw new Error('relay frame too large')
          let end: number
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, end)
            buffer = buffer.slice(end + 2)
            for (const line of frame.split('\n'))
              if (line.startsWith('data:')) {
                const event = JSON.parse(line.slice(5)) as Frame
                if (event.log === log) {
                  try {
                    onBytes(
                      await verifiedDecrypt(
                        config,
                        log,
                        String(event.payload_hex),
                        await stateFor(config, await authorizedSession(config), true),
                        sessionFor(config.space)
                      )
                    )
                  } catch {
                    /* durable replay validates and reports failures */
                  }
                }
              }
          }
        }
      } finally {
        await reader.cancel()
      }
    } catch {
      if (!signal.aborted) await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
}

const writerChecks = new Map<string, number>()
async function verifiedDecrypt(
  config: ShareConfig,
  log: string,
  hex: string,
  state: import('./client.js').ShareState,
  session: import('./vault.js').Session,
  catalogue = false
): Promise<Uint8Array> {
  const record = JSON.parse(Buffer.from(hex, 'hex').toString('utf8')) as { senderId: string; epoch: number }
  const sender = state.devices.find((d) => d.id === record.senderId)
  if (!sender) throw new Error('unknown encrypted-record writer')
  const currentEpoch = Math.max(0, ...session.keys.map((k) => k.epoch))
  const cache = `${config.space}:${sender.id}:${record.epoch === currentEpoch ? 'current' : 'history'}`
  const key = session.keys.find((k) => k.epoch === record.epoch)
  const known = [
    session.device.device,
    ...(session.trustedDevices ?? []),
    ...session.keys.flatMap((k) => (k.issuer ? [k.issuer] : []))
  ].some(
    (d) => d.id === sender.id && d.signPublicKey === sender.signPublicKey && d.boxPublicKey === sender.boxPublicKey
  )
  const knownWriter =
    (session.writerDevices ?? []).includes(sender.id) || session.keys.some((k) => k.issuer?.id === sender.id)
  let checkedWriter = false
  if (Date.now() - (writerChecks.get(cache) ?? 0) > 120000) {
    let refused = false
    try {
      await verifyDevice(config, sender, session.githubToken)
      if (
        record.epoch === currentEpoch &&
        (await memberAccess(config, sender.login, sender.githubId, session.githubToken)) !== 'write'
      ) {
        refused = true
        throw new Error('encrypted record is not from a repo writer')
      }
      checkedWriter = record.epoch === currentEpoch
      writerChecks.set(cache, Date.now())
    } catch (error) {
      if (refused || !known || (record.epoch === currentEpoch && !knownWriter)) throw error
    }
  }
  const plain = decrypt(config.space, log, hex, session.keys, sender)
  if (!key) throw new Error('waiting for epoch key')
  const identity = catalogue ? createHash('sha256').update(plain).digest('hex') : decodeBlob(plain).envelope.hash
  const expected = opaqueName(JSON.stringify(['dedup-v1', log, identity]), key.dedupKey)
  if ((JSON.parse(Buffer.from(hex, 'hex').toString('utf8')) as { dedup: string }).dedup !== expected)
    throw new Error('encrypted dedup identity mismatch')
  if (checkedWriter) {
    session.trustedDevices = [
      ...new Map([...(session.trustedDevices ?? []), sender].map((d) => [d.id, d])).values()
    ].slice(-1000)
    session.writerDevices = [...new Set([...(session.writerDevices ?? []), sender.id])].slice(-1000)
    saveSession(config.space, session)
  }
  return plain
}

/** Key handover continues for signed-in repositories even when no design is open. */
export async function maintainKnownRepos(): Promise<void> {
  for (const [space, session] of Object.entries(readVault().sessions)) {
    if (!session.repoRoot) continue
    try {
      const config = readShareConfig(session.repoRoot)
      if (config && config.space === space) await refreshKeys(config)
    } catch {
      /* per-space status contains the reason; local editing remains available */
    }
  }
}

export async function prepareSharingRead(config: ShareConfig): Promise<void> {
  try {
    await refreshKeys(config)
  } catch (error) {
    if (!sessionFor(config.space).keys.length) throw error
  }
}

/** Bounded best-effort hints run independently of the durable publisher. The chain remains the outbox. */
export class ShareHints {
  private pending = new Map<string, string>()
  private bytes = 0
  private stopped = false
  private task: Promise<void> | undefined
  private bridge: Bridge
  constructor(
    config: CombConfig,
    private log: string
  ) {
    this.bridge = createBridge(config)
  }
  push(changes: { hash: string; hex: string }[]): string[] {
    if (this.stopped) return []
    const accepted: string[] = []
    for (const change of changes) {
      const next = this.bytes + change.hex.length / 2 - (this.pending.get(change.hash)?.length ?? 0) / 2
      if ((this.pending.size >= 32 && !this.pending.has(change.hash)) || next > 1048576) break
      this.pending.set(change.hash, change.hex)
      this.bytes = next
      accepted.push(change.hash)
    }
    this.start()
    return accepted
  }
  private start(): void {
    if (this.task || this.stopped || !this.pending.size) return
    this.task = this.drain().finally(() => {
      this.task = undefined
      this.start()
    })
  }
  private async drain(): Promise<void> {
    while (!this.stopped && this.pending.size) {
      const [hash, hex] = this.pending.entries().next().value!
      this.pending.delete(hash)
      this.bytes -= hex.length / 2
      try {
        await this.bridge.request('hint', { log: this.log, idempotency_key: hash, payload_hex: hex })
      } catch {
        /* Durable publication repairs any lost hint. */
      }
    }
  }
  async close(): Promise<void> {
    this.stopped = true
    this.pending.clear()
    this.bytes = 0
    this.bridge.close()
    await this.task
  }
}
