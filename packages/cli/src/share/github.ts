import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deviceId, deviceStatement, unb64, type Device } from './crypto.js'
import type { ShareConfig } from './config.js'
export class DeviceBindingError extends Error {}
const verifiedBindings = new Map<string, number>()
const BINDING_TTL = 10 * 60 * 1000
const invalidBindings = new Map<string, { at: number; error: DeviceBindingError }>()
const checkingBindings = new Map<string, Promise<void>>()
const checkingMemberships = new Map<string, Promise<'read' | 'write' | 'none'>>()
const memberships = new Map<string, { at: number; permission: 'read' | 'write' | 'none' }>()
export function githubBase(): string {
  const stub = process.env.FOUNDATION_SHARE_TEST_GITHUB
  if (!stub) return 'https://api.github.com'
  const url = new URL(stub)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error('test GitHub stub must be loopback HTTP')
  return url.origin
}
export async function github(path: string, token: string): Promise<Response> {
  return fetch(`${githubBase()}${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10000),
    redirect: 'error'
  })
}
export async function githubIdentity(token: string): Promise<{ login: string; id: number }> {
  const response = await github('/user', token)
  if (!response.ok) throw new Error('GitHub sign-in failed')
  const user = (await response.json()) as { login: string; id: number }
  if (!/^[A-Za-z0-9-]+$/.test(user.login) || !Number.isSafeInteger(user.id)) throw new Error('invalid GitHub identity')
  return user
}
export async function memberAccess(
  config: ShareConfig,
  login: string,
  githubId: number,
  token: string
): Promise<'read' | 'write' | 'none'> {
  const cacheKey = JSON.stringify([
    githubBase(),
    config.repo,
    config.publicAccess,
    login,
    githubId,
    createHash('sha256').update(token).digest('hex')
  ])
  const prior = memberships.get(cacheKey)
  if (prior && Date.now() - prior.at < 120000) return prior.permission
  const checking = checkingMemberships.get(cacheKey)
  if (checking) return checking
  const task = memberAccessFresh(config, login, githubId, token).then((permission) => {
    if (memberships.size >= 4096) memberships.delete(memberships.keys().next().value!)
    if (permission === 'none') memberships.delete(cacheKey)
    else memberships.set(cacheKey, { at: Date.now(), permission })
    return permission
  })
  checkingMemberships.set(cacheKey, task)
  try {
    return await task
  } finally {
    if (checkingMemberships.get(cacheKey) === task) checkingMemberships.delete(cacheKey)
  }
}
async function memberAccessFresh(
  config: ShareConfig,
  login: string,
  githubId: number,
  token: string
): Promise<'read' | 'write' | 'none'> {
  if (!/^[A-Za-z0-9-]+$/.test(login)) throw new DeviceBindingError('invalid member login')
  const response = await github(`/repos/${config.repo.slice(11)}/collaborators/${login}/permission`, token)
  // A 404 can also hide insufficient observer permissions: do not treat it as proof of removal.
  if (response.status === 404 || (response.ok && config.publicAccess === 'collaborators')) {
    const repo = await github(`/repos/${config.repo.slice(11)}`, token)
    if (!repo.ok) throw new Error('observer cannot independently verify repo access')
    const info = (await repo.json()) as { private: boolean }
    if (info.private === false && config.publicAccess !== 'collaborators') return 'read'
    if (typeof info.private !== 'boolean') throw new Error('unknown repository visibility')
    // Only a complete successful collaborator listing proves absence; a hidden 404 alone does not.
    for (let page = 1; page <= 1000; page++) {
      const list = await github(
        `/repos/${config.repo.slice(11)}/collaborators?affiliation=all&per_page=100&page=${page}`,
        token
      )
      if (!list.ok) throw new Error('cannot independently list collaborators to confirm removal')
      const users = (await list.json()) as { id: number; login: string; permissions?: { push?: boolean } }[]
      if (!Array.isArray(users)) throw new Error('invalid GitHub collaborators')
      const user = users.find((user) => user.id === githubId && user.login.toLowerCase() === login.toLowerCase())
      if (user) return user.permissions?.push ? 'write' : 'read'
      if (users.length < 100) return 'none'
    }
    throw new Error('collaborator listing exceeded bound')
  }
  if (!response.ok) throw new Error(`cannot independently check ${login}'s repo access (GitHub ${response.status})`)
  const value = (await response.json()) as { permission: string; user?: { id: number; login: string } }
  if (!value.user || value.user.id !== githubId || value.user.login.toLowerCase() !== login.toLowerCase())
    throw new DeviceBindingError('GitHub member identity mismatch')
  if (value.permission === 'none') return 'none'
  if (['write', 'admin', 'maintain'].includes(value.permission)) return 'write'
  if (['read', 'triage'].includes(value.permission)) return 'read'
  throw new Error('unknown GitHub permission')
}
export function signDevice(statement: string, key: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'foundation-sign-'))
  try {
    const file = join(dir, 'statement')
    writeFileSync(file, statement, { mode: 0o600 })
    execFileSync('ssh-keygen', ['-Y', 'sign', '-f', key, '-n', 'foundation-share', file], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return execFileSync('cat', [`${file}.sig`], { encoding: 'utf8' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
export async function verifyDevice(config: ShareConfig, device: Device, token: string, force = false): Promise<void> {
  const cacheKey = JSON.stringify([githubBase(), config.service, config.space, config.repo, device])
  const previous = verifiedBindings.get(cacheKey),
    invalid = invalidBindings.get(cacheKey)
  if (!force && previous !== undefined && Date.now() - previous < BINDING_TTL) return
  if (!force && invalid && Date.now() - invalid.at < BINDING_TTL) throw invalid.error
  const checking = checkingBindings.get(cacheKey)
  if (checking && !force) return checking
  const task = (async () => {
    try {
      await verifyDeviceFresh(config, device, token)
    } catch (error) {
      if (error instanceof DeviceBindingError) {
        verifiedBindings.delete(cacheKey)
        if (invalidBindings.size >= 4096) invalidBindings.delete(invalidBindings.keys().next().value!)
        invalidBindings.set(cacheKey, { at: Date.now(), error })
      }
      throw error
    }
    invalidBindings.delete(cacheKey)
    if (verifiedBindings.size >= 4096) verifiedBindings.delete(verifiedBindings.keys().next().value!)
    verifiedBindings.set(cacheKey, Date.now())
  })()
  checkingBindings.set(cacheKey, task)
  try {
    await task
  } finally {
    if (checkingBindings.get(cacheKey) === task) checkingBindings.delete(cacheKey)
  }
}
async function verifyDeviceFresh(config: ShareConfig, device: Device, token: string): Promise<void> {
  if (device.service !== config.service) throw new DeviceBindingError('device service mismatch')
  if (!/^[A-Za-z0-9-]+$/.test(device.login) || !Number.isSafeInteger(device.githubId))
    throw new DeviceBindingError('invalid device identity')
  try {
    unb64(device.boxPublicKey, 32)
    unb64(device.signPublicKey, 32)
  } catch {
    throw new DeviceBindingError('invalid device public key')
  }
  const resolved = await github(`/user/${device.githubId}`, token)
  if (resolved.status === 404) throw new DeviceBindingError('GitHub account no longer exists; re-attest device')
  if (!resolved.ok) throw new Error(`cannot resolve GitHub account id (HTTP ${resolved.status})`)
  const identity = (await resolved.json()) as { id: number; login: string }
  if (identity.id !== device.githubId || identity.login.toLowerCase() !== device.login.toLowerCase())
    throw new DeviceBindingError('GitHub account renamed; device must be re-attested')
  const statement = deviceStatement(config.service, config.space, config.repo, device)
  if (deviceId(statement) !== device.id) throw new DeviceBindingError('device statement mismatch')
  const url = process.env.FOUNDATION_SHARE_TEST_GITHUB
    ? `${githubBase()}/${device.login}.keys`
    : `https://github.com/${device.login}.keys`
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'error' })
  if (!response.ok) throw new Error('cannot fetch GitHub SSH keys')
  const text = await response.text()
  if (text.length > 262144) throw new Error('too many GitHub SSH keys')
  const keys = text
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).slice(0, 2).join(' '))
    .filter((line) => /^(ssh-|ecdsa-|sk-)[A-Za-z0-9@._+-]+ [A-Za-z0-9+/=]+$/.test(line))
  if (!keys.length) throw new DeviceBindingError('no GitHub SSH keys available')
  const dir = mkdtempSync(join(tmpdir(), 'foundation-verify-'))
  try {
    writeFileSync(
      join(dir, 'allowed'),
      keys.map((key) => `${device.login} namespaces="foundation-share" ${key}`).join('\n'),
      { mode: 0o600 }
    )
    writeFileSync(join(dir, 'sig'), device.signature, { mode: 0o600 })
    execFileSync(
      'ssh-keygen',
      [
        '-Y',
        'verify',
        '-f',
        join(dir, 'allowed'),
        '-I',
        device.login,
        '-n',
        'foundation-share',
        '-s',
        join(dir, 'sig')
      ],
      { input: statement, stdio: ['pipe', 'pipe', 'pipe'] }
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('SSH verifier unavailable')
    throw new DeviceBindingError('device signature does not match GitHub SSH keys')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
