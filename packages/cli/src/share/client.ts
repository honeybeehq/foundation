import { execFileSync } from 'node:child_process'
import {
  ready,
  generateDeviceKeys,
  deviceId,
  deviceStatement,
  newEpoch,
  wrapKey,
  unwrapKey,
  recoveryKeypair,
  keyId,
  certifyEpoch,
  verifyEpochCertificate,
  authProof,
  type Device,
  type EpochKey,
  type WrappedKey
} from './crypto.js'
import { sessionFor, saveSession, type Session } from './vault.js'
import { DeviceBindingError, githubIdentity, memberAccess, signDevice, verifyDevice } from './github.js'
import type { ShareConfig } from './config.js'
export interface ShareState {
  space: string
  repo: string
  epoch: number
  devices: Device[]
  wraps: WrappedKey[]
  revoked: string[]
  recoveryPublicKey?: string
  accessLost?: string[]
}
export class ShareError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message)
  }
}
export async function api<T>(
  config: Pick<ShareConfig, 'service'>,
  path: string,
  token?: string,
  body?: unknown,
  timeoutMs = 35000
): Promise<T> {
  const response = await fetch(`${config.service}/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error'
  })
  if (!response.ok) {
    const text = await response.text()
    throw new ShareError(
      response.status === 403 ? 'Live sharing: no access' : `share service ${response.status}: ${text.slice(0, 256)}`,
      response.status
    )
  }
  return (await response.json()) as T
}
export function ghToken(): string {
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    throw new Error('Sign in with GitHub using share login or gh auth login')
  }
}
export async function renew(config: ShareConfig, session: Session, replaceDevice = false): Promise<Session> {
  const { challenge } = await api<{ challenge: string }>(config, `challenge?space=${encodeURIComponent(config.space)}`)
  const result = await api<{ token: string; expiresAt: number; permission: string }>(config, 'token', undefined, {
    space: config.space,
    device: session.device.device,
    challenge,
    proof: authProof(config.service, config.space, challenge, session.device)
  })
  session = { ...session, ...result }
  saveSession(config.space, session, replaceDevice)
  return session
}
export async function prepareDevice(
  config: ShareConfig,
  token: string,
  sshKey: string,
  reattest = false,
  newDevice = false
): Promise<Session> {
  await ready
  let prior: Session | undefined
  try {
    prior = sessionFor(config.space)
  } catch {}
  const user = await githubIdentity(token)
  if (prior) {
    if (prior.device.device.githubId !== user.id)
      throw new Error('this space is already signed in as another GitHub user')
    if (prior.device.device.login === user.login && !newDevice) {
      if (!reattest) return { ...prior, githubToken: token }
      const device = {
        ...prior.device.device,
        signature: signDevice(deviceStatement(config.service, config.space, config.repo, prior.device.device), sshKey)
      }
      await verifyDevice(config, device, token, true)
      return {
        ...prior,
        githubToken: token,
        device: { ...prior.device, device },
        rotationRequired: prior.permission === 'write',
        rotationRequiredAtEpoch: Math.max(0, ...prior.keys.map((k) => k.epoch))
      }
    }
    if (!reattest) throw new Error('GitHub account renamed; use share login --reattest')
  }
  const pair = generateDeviceKeys(),
    publicDevice = {
      login: user.login,
      githubId: user.id,
      boxPublicKey: pair.boxPublicKey,
      signPublicKey: pair.signPublicKey
    }
  const statement = deviceStatement(config.service, config.space, config.repo, publicDevice)
  const device = {
    ...publicDevice,
    service: config.service,
    id: deviceId(statement),
    signature: signDevice(statement, sshKey)
  }
  await verifyDevice(config, device, token)
  return {
    device: { device, boxSecretKey: pair.boxSecretKey, signSecretKey: pair.signSecretKey },
    githubToken: token,
    token: '',
    expiresAt: 0,
    permission: '',
    keys: prior?.keys ?? [],
    repoRoot: prior?.repoRoot,
    rotationRequired: !!prior,
    rotationRequiredAtEpoch: Math.max(0, ...(prior?.keys ?? []).map((k) => k.epoch))
  }
}
export async function login(
  config: ShareConfig,
  token: string,
  sshKey: string,
  reattest = false,
  newDevice = false
): Promise<Session> {
  const prepared = await prepareDevice(config, token, sshKey, reattest)
  try {
    return await renew(config, prepared, reattest)
  } catch (error) {
    if (!reattest || !(error instanceof ShareError) || error.status !== 403) throw error
    return renew(config, await prepareDevice(config, token, sshKey, true, true), true)
  }
}
export async function createSpace(config: ShareConfig, challenge: string, session: Session): Promise<void> {
  await api(config, 'spaces', undefined, {
    repo: config.repo,
    device: session.device.device,
    challenge,
    proof: authProof(config.service, config.space, challenge, session.device),
    publicAccess: config.publicAccess ?? 'collaborators'
  })
  await renew(config, session)
}
export async function authorizedSession(config: ShareConfig): Promise<Session> {
  let session = sessionFor(config.space)
  if (session.expiresAt < Date.now() + 60000) session = await renew(config, session)
  return session
}
export async function stateFor(config: ShareConfig, session: Session, readOnly = false): Promise<ShareState> {
  let state: ShareState
  try {
    state = await api<ShareState>(config, `state?space=${encodeURIComponent(config.space)}`, session.token)
  } catch (error) {
    if (!(error instanceof ShareError) || error.status !== 401) throw error
    Object.assign(session, await renew(config, session))
    state = await api<ShareState>(config, `state?space=${encodeURIComponent(config.space)}`, session.token)
  }
  const highest = Math.max(0, ...session.keys.map((k) => k.epoch))
  if (!readOnly && state.epoch < highest) throw new Error(`service rolled back epoch ${highest} to ${state.epoch}`)
  if (!readOnly && state.epoch !== 0 && config.recoveryPublicKey && state.recoveryPublicKey !== config.recoveryPublicKey)
    throw new Error('recovery key differs from committed share.json')
  if (state.space !== config.space || state.repo.toLowerCase() !== config.repo.toLowerCase())
    throw new Error('share space/repo mismatch')
  return state
}
async function trusted(config: ShareConfig, device: Device, session: Session): Promise<boolean> {
  const access = await memberAccess(config, device.login, device.githubId, session.githubToken)
  if (access === 'none') return false
  await verifyDevice(config, device, session.githubToken)
  if (access === 'write')
    session.writerDevices = [...new Set([...(session.writerDevices ?? []), device.id])].slice(-1000)
  session.trustedDevices = [
    ...new Map([...(session.trustedDevices ?? []), device].map((d) => [d.id, d])).values()
  ].slice(-1000)
  return true
}
function packageWraps(
  config: ShareConfig,
  key: EpochKey,
  devices: Device[],
  session: Session,
  recovery?: string
): WrappedKey[] {
  const wraps = devices.map((device) => wrapKey(config.space, key, device, session.device))
  if (recovery) wraps.push(wrapKey(config.space, key, { id: 'recovery', boxPublicKey: recovery }, session.device))
  return wraps
}
export async function initializeKeys(config: ShareConfig, recoveryCode?: string): Promise<string> {
  await ready
  const session = await authorizedSession(config),
    state = await stateFor(config, session)
  if (state.epoch !== 0) throw new Error('space already initialized')
  const key = newEpoch(),
    recovery = recoveryCode ? {code:recoveryCode,publicKey:(await import('./crypto.js')).recoveryPublicKey(recoveryCode)} : recoveryKeypair()
  if (config.recoveryPublicKey && config.recoveryPublicKey !== recovery.publicKey) throw new Error('recovery code differs from committed share.json')
  config.recoveryPublicKey = recovery.publicKey
  Object.assign(key, {
    space: config.space,
    repo: config.repo,
    prevEpoch: 0,
    recipients: [
      {
        deviceId: session.device.device.id,
        login: session.device.device.login,
        githubId: session.device.device.githubId
      }
    ]
  })
  certifyEpoch(key, session.device)
  const wraps = packageWraps(config, key, [session.device.device], session, recovery.publicKey)
  await api(config, 'keys', session.token, {
    space: config.space,
    expectedEpoch: 0,
    epoch: 1,
    wraps,
    recoveryPublicKey: recovery.publicKey
  })
  saveSession(config.space, { ...session, keys: [key], recoveryPublicKey: recovery.publicKey })
  return recovery.code
}
/** Called by the daemon independently of document workers; no service-provided access claims trusted for handover. */
const lastMembershipPoll = new Map<string, number>()
export async function maintainKeys(
  config: ShareConfig,
  revoke: string[] = []
): Promise<{ session: Session; state: ShareState; warning?: string }> {
  await ready
  let session = await authorizedSession(config),
    state = await stateFor(config, session)
  const highest = Math.max(0, ...session.keys.map((k) => k.epoch))
  if (state.epoch < highest) throw new Error(`service rolled back epoch ${highest} to ${state.epoch}`)
  if (!config.recoveryPublicKey || state.recoveryPublicKey !== config.recoveryPublicKey)
    throw new Error('recovery key differs from committed share.json')
  if (state.revoked.includes(session.device.device.id)) throw new Error('Live sharing: no access (device revoked)')
  const warnings: string[] = []
  for (const wrap of state.wraps.filter(
    (w) => w.deviceId === session.device.device.id && !session.keys.some((key) => key.epoch === w.epoch)
  )) {
    try {
      const sender = state.devices.find((d) => d.id === wrap.senderId)
      if (!sender) throw new Error('unknown wrapped-key sender')
      // Accept key material only from a device independently verified as a current member.
      if (!(await trusted(config, sender, session)))
        throw new Error('wrapped-key sender no longer has repo access; wait for another member')
      const key = unwrapKey(config.space, wrap, sender, session.device)
      verifyEpochCertificate(key)
      const issuer = key.issuer!
      await verifyDevice(config, issuer, session.githubToken)
      if ((await memberAccess(config, issuer.login, issuer.githubId, session.githubToken)) !== 'write')
        throw new Error('epoch issuer no longer has write access')
      if (key.space !== config.space || key.repo !== config.repo || !Array.isArray(key.recipients))
        throw new Error('epoch package context mismatch')
      const prior = session.keys.find((k) => k.epoch === key.epoch)
      if (prior && keyId(prior) !== keyId(key)) throw new Error(`key fork at epoch ${key.epoch}`)
      if (session.keys.length && session.keys.some((k) => k.feedKey !== key.feedKey))
        throw new Error('routing keys changed unexpectedly')
      for (const item of [...(key.history ?? []), key])
        if (!session.keys.some((k) => k.epoch === item.epoch)) session.keys.push(item)
    } catch (error) {
      warnings.push(`Skipped key epoch ${wrap.epoch}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  session.recoveryPublicKey = config.recoveryPublicKey
  saveSession(config.space, session)
  const current = session.keys.find((k) => k.epoch === state.epoch)
  if (!current) return { session, state, warning: warnings.join('; ') || undefined }
  const pending = state.devices.some(
    (d) => !state.revoked.includes(d.id) && !state.wraps.some((w) => w.deviceId === d.id && w.epoch === state.epoch)
  )
  const expired = Date.now() - (current.createdAt ?? 0) >= 24 * 60 * 60 * 1000
  if (
    !session.rotationRequired &&
    !expired &&
    !pending &&
    !revoke.length &&
    !(state.accessLost ?? []).length &&
    Date.now() - (lastMembershipPoll.get(config.space) ?? 0) < 120000
  )
    return { session, state, warning: session.deviceWarnings?.join('; ') || undefined }
  const lost = new Set([...revoke, ...(session.pendingRevocations ?? [])]),
    verified: Device[] = []
  try {
    for (const recipient of current.recipients ?? []) {
      try {
        if ((await memberAccess(config, recipient.login, recipient.githubId, session.githubToken)) === 'none')
          lost.add(recipient.deviceId)
      } catch (error) {
        if (!(error instanceof DeviceBindingError)) throw error
        lost.add(recipient.deviceId)
        warnings.push(`Device ${recipient.login}/${recipient.deviceId.slice(0, 8)} must re-attest: ${error.message}`)
      }
    }
    for (const device of state.devices.filter((d) => !state.revoked.includes(d.id))) {
      if (lost.has(device.id)) continue
      try {
        if (await trusted(config, device, session)) verified.push(device)
        else lost.add(device.id)
      } catch (error) {
        if (!(error instanceof DeviceBindingError)) throw error
        warnings.push(`Device ${device.login}/${device.id.slice(0, 8)} must re-attest: ${error.message}`)
        if (current.recipients?.some((r) => r.deviceId === device.id)) lost.add(device.id)
      }
    }
  } catch (error) {
    if (
      !session.rotationRequired &&
      !revoke.length &&
      !expired &&
      session.membershipCheckedAt &&
      Date.now() - session.membershipCheckedAt < 3600000
    )
      return {
        session,
        state,
        warning: `Cannot confirm members with GitHub since ${new Date(session.membershipCheckedAt).toISOString()}: ${String(error)}`
      }
    throw new Error(
      `Live sharing paused: cannot confirm members with GitHub since ${session.membershipCheckedAt ? new Date(session.membershipCheckedAt).toISOString() : 'startup'}: ${String(error)}`
    )
  }
  session.deviceWarnings = warnings.filter((w) => w.startsWith('Device '))
  session.membershipCheckedAt = Date.now()
  saveSession(config.space, session)
  if (lost.has(session.device.device.id)) throw new Error('Live sharing: no access')
  if (lost.size || expired || session.rotationRequired) {
    session.rotationRequired = true
    session.rotationRequiredAtEpoch = state.epoch
    session.pendingRevocations = [...lost]
    saveSession(config.space, session)
    if (session.permission !== 'write') throw new Error('rotation required: wait for a writer before sending')
    const next = newEpoch(state.epoch + 1, current)
    next.recipients = verified.map((d) => ({ deviceId: d.id, login: d.login, githubId: d.githubId }))
    certifyEpoch(next, session.device)
    const wraps = packageWraps(config, next, verified, session, config.recoveryPublicKey)
    await api(config, 'keys', session.token, {
      space: config.space,
      expectedEpoch: state.epoch,
      epoch: next.epoch,
      wraps,
      revoke: [...lost]
    })
    session.keys.push(next)
    session.rotationRequired = false
    session.pendingRevocations = []
    saveSession(config.space, session)
    state = await stateFor(config, session)
  } else {
    const wraps: WrappedKey[] = []
    current.recipients = [
      ...new Map(
        [
          ...(current.recipients ?? []),
          ...verified.map((d) => ({ deviceId: d.id, login: d.login, githubId: d.githubId }))
        ].map((r) => [r.deviceId, r])
      ).values()
    ]
    saveSession(config.space, session)
    for (const device of verified)
      if (!state.wraps.some((w) => w.deviceId === device.id && w.epoch === current.epoch))
        wraps.push(wrapKey(config.space, current, device, session.device))
    if (wraps.length)
      await api(config, 'keys', session.token, {
        space: config.space,
        expectedEpoch: state.epoch,
        epoch: state.epoch,
        wraps
      })
  }
  lastMembershipPoll.set(config.space, Date.now())
  return { session, state, warning: warnings.join('; ') || undefined }
}
export async function sharingStatus(config: ShareConfig): Promise<{ state: string; epoch?: number; reason?: string }> {
  try {
    const { session, state, warning } = await maintainKeys(config)
    return {
      state: session.keys.some((k) => k.epoch === state.epoch) ? 'shared' : 'waiting for key',
      epoch: state.epoch,
      ...(!session.keys.some((k) => k.epoch === state.epoch)
        ? { reason: warning ?? "Waiting for a teammate's machine to share the key" }
        : warning
          ? { reason: warning }
          : {})
    }
  } catch (error) {
    return {
      state:
        (error instanceof ShareError && error.status === 403) || String(error).includes('no access')
          ? 'no access'
          : String(error).includes('Sign in')
            ? 'sign in'
            : 'unavailable',
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}
export async function rotateRecovery(config: ShareConfig): Promise<string> {
  const { session, state } = await maintainKeys(config),
    current = session.keys.find((k) => k.epoch === state.epoch)
  if (!current || session.permission !== 'write')
    throw new Error('recovery rotation requires a writer with the current key')
  const devices: Device[] = []
  for (const device of state.devices.filter((d) => !state.revoked.includes(d.id)))
    if (await trusted(config, device, session)) devices.push(device)
  const recovery = recoveryKeypair(),
    next = newEpoch(state.epoch + 1, current)
  next.recipients = devices.map((d) => ({ deviceId: d.id, login: d.login, githubId: d.githubId }))
  certifyEpoch(next, session.device)
  await api(config, 'keys', session.token, {
    space: config.space,
    expectedEpoch: state.epoch,
    epoch: next.epoch,
    wraps: packageWraps(config, next, devices, session, recovery.publicKey),
    recoveryPublicKey: recovery.publicKey
  })
  config.recoveryPublicKey = recovery.publicKey
  session.keys.push(next)
  session.recoveryPublicKey = recovery.publicKey
  saveSession(config.space, session)
  return recovery.code
}
export async function restoreRecovery(config: ShareConfig, code: string): Promise<void> {
  const { recoverEpoch } = await import('./crypto.js')
  await ready
  const session = await authorizedSession(config),
    state = await stateFor(config, session)
  if (!config.recoveryPublicKey || state.recoveryPublicKey !== config.recoveryPublicKey)
    throw new Error('recovery key differs from committed share.json')
  const wrap = state.wraps.find((w) => w.deviceId === 'recovery' && w.epoch === state.epoch)
  if (!wrap) throw new Error('no recovery wrap for current epoch')
  const sender = state.devices.find((d) => d.id === wrap.senderId)
  if (!sender || !(await trusted(config, sender, session)))
    throw new Error('recovery sender has no current repo access')
  const key = recoverEpoch(config.space, wrap, sender, code)
  verifyEpochCertificate(key)
  if (key.space !== config.space || key.repo !== config.repo || !key.issuer)
    throw new Error('recovery epoch context mismatch')
  if (
    !(await trusted(config, key.issuer, session)) ||
    (await memberAccess(config, key.issuer.login, key.issuer.githubId, session.githubToken)) !== 'write'
  )
    throw new Error('recovery epoch issuer is not a writer')
  for (const item of [...(key.history ?? []), key])
    if (!session.keys.some((k) => k.epoch === item.epoch)) session.keys.push(item)
  saveSession(config.space, session)
  await maintainKeys(config)
}
