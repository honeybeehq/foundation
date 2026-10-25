import { acquireDocumentLock } from '../document-lock.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, lstatSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import type { Device, DeviceSecret, EpochKey } from './crypto.js'
export interface Session {
  deviceWarnings?: string[]
  trustedDevices?: Device[]
  writerDevices?: string[]
  rotationRequiredAtEpoch?: number
  rotationRequired?: boolean
  pendingRevocations?: string[]
  repoRoot?: string
  membershipCheckedAt?: number
  device: DeviceSecret
  githubToken: string
  token: string
  expiresAt: number
  permission: string
  keys: EpochKey[]
  recoveryPublicKey?: string
}
interface Vault {
  sessions: Record<string, Session>
}
function location(): string {
  const dir = join(homedir(), '.foundation', 'share')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const stat = lstatSync(dir)
  if (stat.isSymbolicLink() || stat.mode & 0o077) throw new Error('share key directory must be private (0700)')
  return join(dir, 'keys.json')
}
export function readVault(): Vault {
  if (process.platform === 'darwin') {
    try {
      return JSON.parse(
        execFileSync('security', ['find-generic-password', '-a', homedir(), '-s', 'foundation-share-v1', '-w'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe']
        })
      )
    } catch (e) {
      if ((e as { status?: number }).status === 44) return { sessions: {} }
      throw new Error('cannot read Foundation sharing keys from Keychain')
    }
  }
  const path = location()
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
      throw new Error('share keys must be a private regular file (0600)')
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { sessions: {} }
    throw e
  }
}
export function saveSession(space: string, session: Session, replaceDevice = false): void {
  const lockPath = location()
  const release = acquireDocumentLock(lockPath, 5000)
  try {
    const vault = readVault()
    const old = vault.sessions[space]
    if (old) {
      if (!replaceDevice && old.device.device.id !== session.device.device.id)
        throw new Error('device binding changed unexpectedly')
      session.writerDevices = [...new Set([...(old.writerDevices ?? []), ...(session.writerDevices ?? [])])].slice(
        -1000
      )
      session.trustedDevices = [
        ...new Map([...(old.trustedDevices ?? []), ...(session.trustedDevices ?? [])].map((d) => [d.id, d])).values()
      ].slice(-1000)
      const merged = new Map(old.keys.map((k) => [k.epoch, k]))
      for (const key of session.keys) {
        const prior = merged.get(key.epoch)
        if (prior && prior.key !== key.key) throw new Error(`key fork at epoch ${key.epoch}`)
        if (prior)
          key.recipients = [
            ...new Map([...(prior.recipients ?? []), ...(key.recipients ?? [])].map((r) => [r.deviceId, r])).values()
          ]
        merged.set(key.epoch, key)
      }
      session.keys = [...merged.values()].sort((a, b) => a.epoch - b.epoch)
      const requested = Math.max(old.rotationRequiredAtEpoch ?? 0, session.rotationRequiredAtEpoch ?? 0)
      const pending = [...new Set([...(old.pendingRevocations ?? []), ...(session.pendingRevocations ?? [])])]
      const latest = session.keys.at(-1)
      if (
        requested &&
        latest &&
        (latest.epoch <= requested || pending.some((id) => latest.recipients?.some((r) => r.deviceId === id)))
      ) {
        session.rotationRequired = true
        session.rotationRequiredAtEpoch = latest.epoch
        session.pendingRevocations = pending
      } else if (latest && latest.epoch > requested) {
        session.rotationRequired = false
        session.rotationRequiredAtEpoch = undefined
        session.pendingRevocations = []
      }

      session.repoRoot ??= old.repoRoot
      session.membershipCheckedAt = Math.max(old.membershipCheckedAt ?? 0, session.membershipCheckedAt ?? 0)
    }
    vault.sessions[space] = session
    const text = JSON.stringify(vault)
    if (process.platform === 'darwin') {
      const quote = (s: string): string => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
      execFileSync('security', ['-i'], {
        input: `add-generic-password -U -a ${quote(homedir())} -s foundation-share-v1 -w ${quote(text)}\n`,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      return
    }
    const path = location(),
      temp = `${path}.${process.pid}.tmp`
    writeFileSync(temp, text, { mode: 0o600, flag: 'wx' })
    chmodSync(temp, 0o600)
    renameSync(temp, path)
  } finally {
    release()
  }
}
export function sessionFor(space: string): Session {
  const session = readVault().sessions[space]
  if (!session) throw new Error('Sign in to share')
  return session
}
