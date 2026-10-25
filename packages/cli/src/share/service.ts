import { createServer, type ServerResponse } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, cp, writeFile, rm } from 'node:fs/promises'
import { resolve, join, sep, isAbsolute } from 'node:path'
import { acquireDocumentLock } from '../document-lock.js'
import { CombBridge, validateAppendReceipt, type Frame } from '../sync/bridge.js'
import { serviceUrl } from './config.js'
import { readGithubAppConfig } from './github-app.js'
import { ShareAuth, ShareAuthError, type PublicAccess } from './auth.js'
import {
  ShareServiceStore,
  backupShareMetadata,
  type ShareDevice,
  type ShareSpace,
  type ShareWrap
} from './service-store.js'

export interface ShareServiceConfig {
  host?: string
  port?: number
  stateDir: string
  comb: { binary: string; args: string[] }
  publicUrl?: string
  allowedRepoOwners?: string[]
  oauthClientId?: string
  /** Complete stopped local backend snapshot for nightly backup. */
  backupLocalStore?: string
  /** Absolute path to private GitHub App config; tokens mint and refresh per repository. */
  githubAppConfig?: string
  /** Test-only static GitHub App installation token: repository Metadata read only. */
  githubPermissionToken?: string
  /** DEVELOPMENT ONLY: GitHub stub on a literal loopback address. Never a remote API override. */
  githubApiUrl?: string
}
const LIMIT = 2 * 1024 * 1024
const HEX = /^[a-f0-9]{64}$/
const loopback = (host: string) => ['127.0.0.1', '[::1]', '::1', 'localhost'].includes(host)
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}
function requireThat(value: unknown, message: string, status = 400): asserts value {
  if (!value) throw new HttpError(status, message)
}
function object(value: unknown): Record<string, any> {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'expected JSON object')
  return value as Record<string, any>
}
function base64(value: unknown, bytes?: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= LIMIT &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) &&
    (bytes === undefined || Buffer.from(value, 'base64').length === bytes)
  )
}
function exact(value: Record<string, any>, keys: string[]): void {
  requireThat(
    Object.keys(value).every((k) => keys.includes(k)),
    'unknown fields'
  )
}
function repoName(value: unknown): string {
  requireThat(
    typeof value === 'string' &&
      /^github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) &&
      !value.endsWith('.git'),
    'expected github.com/OWNER/REPO'
  )
  return value.toLowerCase()
}
function deviceStatement(value: unknown, space: ShareSpace, identity: { login: string; id: number }): ShareDevice {
  const d = object(value)
  exact(d, ['id', 'service', 'login', 'githubId', 'boxPublicKey', 'signPublicKey', 'signature'])
  requireThat(
    typeof d.login === 'string' &&
      d.githubId > 0 &&
      d.login === identity.login &&
      d.githubId === identity.id &&
      Number.isSafeInteger(d.githubId),
    'device identity mismatch',
    403
  )
  requireThat(
    base64(d.boxPublicKey, 32) &&
      base64(d.signPublicKey, 32) &&
      typeof d.signature === 'string' &&
      d.signature.startsWith('-----BEGIN SSH SIGNATURE-----') &&
      d.signature.trimEnd().endsWith('-----END SSH SIGNATURE-----') &&
      d.signature.length < 16384,
    'invalid device keys/signature'
  )
  requireThat(typeof d.service === 'string', 'device.service required')
  const url = new URL(d.service)
  requireThat(
    !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && loopback(url.hostname))),
    'invalid device service URL'
  )
  const canonical = JSON.stringify([
    'foundation-device-v1',
    d.service,
    space.space,
    space.repo,
    d.login,
    d.githubId,
    d.boxPublicKey,
    d.signPublicKey
  ])
  requireThat(d.id === createHash('sha256').update(canonical).digest('hex'), 'device id does not match statement')
  return d as ShareDevice
}
function ciphertext(payload: unknown, epoch: number, senderId: string): string {
  requireThat(
    typeof payload === 'string' && payload.length > 0 && payload.length <= 980000 && /^(?:[a-f0-9]{2})+$/.test(payload),
    'invalid payload_hex'
  )
  let record: Record<string, any>
  try {
    record = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(payload, 'hex'))))
  } catch {
    throw new HttpError(400, 'expected encrypted envelope')
  }
  exact(record, ['v', 'epoch', 'dedup', 'nonce', 'ciphertext', 'keyId', 'senderId', 'signature'])
  requireThat(
    record.v === 1 &&
      record.epoch === epoch &&
      typeof record.keyId === 'string' &&
      /^[a-f0-9]{32}$/.test(record.keyId) &&
      record.senderId === senderId &&
      HEX.test(record.senderId) &&
      base64(record.signature, 64) &&
      HEX.test(record.dedup) &&
      base64(record.nonce, 24) &&
      base64(record.ciphertext) &&
      Buffer.from(record.ciphertext, 'base64').length >= 16,
    'invalid encrypted envelope'
  )
  return payload
}
type ServiceSpace = ShareSpace & { service?: string; publicAccess?: PublicAccess; accessLost?: string[] }
interface Token {
  space: string
  device: string
  permission: 'read' | 'write'
  expiresAt: number
}
const active = new Set<string>()

export async function startShareService(config: ShareServiceConfig) {
  if (config.githubAppConfig) {
    requireThat(isAbsolute(config.githubAppConfig), 'githubAppConfig must be an absolute path')
    requireThat(!config.githubPermissionToken && !config.githubApiUrl, 'githubAppConfig cannot be combined with static token or development stub')
    await readGithubAppConfig(config.githubAppConfig)
  }
  if (!config.githubApiUrl && !config.publicUrl) throw new Error('publicUrl is required for a production share service')
  let publicOrigin = config.publicUrl ? serviceUrl(config.publicUrl) : ''
  if (publicOrigin && !config.githubApiUrl && !publicOrigin.startsWith('https://')) throw new Error('production publicUrl requires HTTPS')
  if (config.allowedRepoOwners && (!Array.isArray(config.allowedRepoOwners) || !config.allowedRepoOwners.length || config.allowedRepoOwners.some(owner => typeof owner !== 'string' || !/^[A-Za-z0-9-]+$/.test(owner)))) throw new Error('allowedRepoOwners must be a nonempty array of GitHub owner names')
  const allowRepo = (repo: string): void => {
    requireThat(!config.allowedRepoOwners || config.allowedRepoOwners.some(owner => owner.toLowerCase() === repo.split('/')[1]?.toLowerCase()), 'repository owner is not allowed on this service', 403)
  }
  const stateDir = resolve(config.stateDir)
  requireThat(!active.has(stateDir), 'service already running for stateDir', 409)
  let github = 'https://api.github.com'
  if (config.githubApiUrl) {
    const url = new URL(config.githubApiUrl)
    requireThat(
      url.protocol === 'http:' &&
        ['127.0.0.1', '[::1]'].includes(url.hostname) &&
        !url.username &&
        !url.password &&
        url.pathname === '/' &&
        !url.search &&
        !url.hash,
      'development GitHub stub must use literal loopback HTTP origin'
    )
    github = url.origin
  }
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  const release = acquireDocumentLock(join(stateDir, 'service'), 100)
  let store: ShareServiceStore
  try {
    store = await ShareServiceStore.open(stateDir)
  } catch (error) {
    release()
    throw error
  }
  const githubAuth = new ShareAuth({ ...config, githubApiUrl: config.githubApiUrl ? github : undefined })
  const tokens = new Map<string, Token>()
  const relays = new Map<ServerResponse, { token: string; timer: NodeJS.Timeout }>()
  const queues = new Map<string, Promise<unknown>>()
  const bridges = new Set<CombBridge>()
  let closing = false
  const bridge = () => {
    const b = new CombBridge(config.comb.binary, config.comb.args)
    bridges.add(b)
    return b
  }
  async function permission(space: ServiceSpace, device: ShareDevice) {
    allowRepo(space.repo)
    requireThat(device.service === publicOrigin, 'device service differs from configured publicUrl', 403)
    await githubAuth.descriptor(space.repo, publicOrigin, space.space)
    const result = await githubAuth.permission(space.repo, device.login, space.publicAccess ?? 'collaborators')
    if (result === 'none') {
      await store.update((spaces) => {
        const current = spaces.find((s) => s.space === space.space) as ServiceSpace | undefined
        if (!current) return
        current.accessLost = [
          ...new Set([
            ...(current.accessLost ?? []),
            ...current.devices
              .filter((d) => d.githubId === device.githubId && !current.revoked.includes(d.id))
              .map((d) => d.id)
          ])
        ]
      })
      disconnectRevoked()
      throw new HttpError(403, 'GitHub repo access denied')
    }
    return result
  }
  function authenticate(bearer: string): { token: Token; space: ServiceSpace } {
    const token = tokens.get(bearer)
    requireThat(token && token.expiresAt > Date.now(), 'invalid or expired token', 401)
    const space = store.get(token.space) as ServiceSpace | undefined
    requireThat(
      space && !space.revoked.includes(token.device) && !space.accessLost?.includes(token.device),
      'device revoked',
      403
    )
    allowRepo(space.repo)
    return { token, space }
  }
  function disconnectRevoked() {
    for (const [response, relay] of relays) {
      try {
        authenticate(relay.token)
      } catch {
        clearTimeout(relay.timer)
        response.end()
        relays.delete(response)
      }
    }
  }
  const descriptorTimer = setInterval(() => {
    for (const [response, relay] of relays) {
      const space = store.get(tokens.get(relay.token)?.space ?? '') as ServiceSpace | undefined
      if (!space) continue
      void githubAuth.descriptor(space.repo, publicOrigin, space.space).catch(() => {
        tokens.delete(relay.token); response.end()
      })
    }
  }, 30000)
  descriptorTimer.unref()
  const server = createServer(async (request, response) => {
    const send = (status: number, value: unknown) => {
      const data = JSON.stringify(value)
      if (Buffer.byteLength(data) > LIMIT) {
        response.writeHead(502).end('{"error":"response too large"}')
        return
      }
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(data)
    }
    try {
      requireThat(!closing, 'service closing', 503)
      const requestUrl = new URL(request.url ?? '/', 'http://localhost')
      const path = requestUrl.pathname
      const method = request.method
      if (method === 'GET' && path === '/v1/oauth') {
        send(200, { clientId: config.oauthClientId ?? null })
        return
      }
      const auth = request.headers.authorization
      if (method === 'GET' && path === '/v1/challenge') {
        requireThat(!auth, 'never send GitHub credentials to the share service')
        const id = requestUrl.searchParams.get('space')
        const repoQuery = requestUrl.searchParams.get('repo')
        requireThat(!!id !== !!repoQuery, 'supply space or repo')
        if (id) {
          const space = store.get(id)
          requireThat(space, 'unknown space', 404)
          allowRepo(space.repo)
          send(200, githubAuth.challenge('token', space.space, space.repo))
        } else {
          const repo = repoName(repoQuery)
          allowRepo(repo)
          const existing = store.spaces().find((s) => s.repo === repo)
          const requested = requestUrl.searchParams.get('requestedSpace')
          requireThat(!requested || /^sp_[a-f0-9]{32}$/.test(requested), 'invalid requested space')
          send(200, githubAuth.challenge('create', existing?.space ?? requested ?? `sp_${randomBytes(16).toString('hex')}`, repo))
        }
        return
      }
      let body: Record<string, any> = {}
      if (method === 'POST') {
        let size = 0
        const chunks: Buffer[] = []
        for await (const chunk of request) {
          size += chunk.length
          requireThat(size <= LIMIT, 'body too large', 413)
          chunks.push(chunk)
        }
        try {
          body = object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch (error) {
          if (error instanceof HttpError) throw error
          throw new HttpError(400, 'invalid JSON')
        }
      }
      if (method === 'POST' && path === '/v1/spaces') {
        requireThat(!auth, 'never send GitHub credentials to the share service')
        exact(body, ['repo', 'device', 'challenge', 'proof', 'publicAccess'])
        const repo = repoName(body.repo)
        allowRepo(repo)
        const challenge = githubAuth.consume(body.challenge, 'create')
        requireThat(challenge.repo === repo, 'challenge repo mismatch', 401)
        const publicAccess = body.publicAccess ?? 'collaborators'
        requireThat(['repo-read', 'collaborators'].includes(publicAccess), 'invalid public access policy')
        const candidate: ServiceSpace = {
          space: challenge.space,
          repo,
          publicAccess,
          epoch: 0,
          devices: [],
          wraps: [],
          revoked: []
        }
        const device = deviceStatement(body.device, candidate, { login: body.device?.login, id: body.device?.githubId })
        candidate.service = device.service
        await githubAuth.verifyDevice(device, repo, candidate.space, body.challenge, body.proof)
        const access = await permission(candidate, device)
        requireThat(access === 'write', 'write permission required', 403)
        const result = await store.update((spaces) => {
          requireThat(!spaces.some(s => s.space === candidate.space && s.repo !== repo), 'space is already bound to another repository', 409)
          const existing = spaces.find((s) => s.repo === repo) as ServiceSpace | undefined
          if (existing) {
            requireThat(existing.space === challenge.space, 'space created concurrently; request new challenge', 409)
            requireThat((existing.publicAccess ?? 'collaborators') === publicAccess, 'immutable public access policy', 409)
            return { space: existing.space, repo, publicAccess: existing.publicAccess ?? 'collaborators' }
          }
          spaces.push(candidate)
          return { space: candidate.space, repo, publicAccess }
        })
        send(200, result)
        return
      }
      if (method === 'POST' && path === '/v1/token') {
        requireThat(!auth, 'never send GitHub credentials to the share service')
        exact(body, ['space', 'device', 'challenge', 'proof'])
        const challenge = githubAuth.consume(body.challenge, 'token')
        requireThat(challenge.space === body.space, 'challenge space mismatch', 401)
        const space = store.get(body.space) as ServiceSpace | undefined
        requireThat(space && space.repo === challenge.repo, 'unknown space', 404)
        const device = deviceStatement(body.device, space, { login: body.device?.login, id: body.device?.githubId })
        await githubAuth.verifyDevice(device, space.repo, space.space, body.challenge, body.proof)
        const access = await permission(space, device)
        await store.update((spaces) => {
          const current = spaces.find((s) => s.space === space.space)! as ServiceSpace
          requireThat(!current.revoked.includes(device.id), 'device revoked', 403)
          const old = current.devices.find((d) => d.id === device.id)
          requireThat(
            !old ||
              (['id', 'service', 'login', 'githubId', 'boxPublicKey', 'signPublicKey'] as const).every(
                (key) => old[key] === device[key]
              ),
            'immutable device binding',
            409
          )
          if (old) old.signature = device.signature
          if (!old) {
            requireThat(current.devices.length < 1000, 'device registry full', 409)
            current.devices.push(device)
          }
          current.accessLost = (current.accessLost ?? []).filter(
            (id) => !current.devices.some((d) => d.id === id && d.githubId === device.githubId)
          )
          requireThat(Buffer.byteLength(JSON.stringify(current)) < LIMIT - 1024, 'space metadata full', 409)
        })
        const token = randomBytes(32).toString('base64url')
        const expiresAt = Date.now() + 3600000
        for (const [key, value] of tokens) if (value.expiresAt <= Date.now()) tokens.delete(key)
        requireThat(tokens.size < 10000, 'token capacity reached', 503)
        tokens.set(token, { space: space.space, device: device.id, permission: access, expiresAt })
        send(200, {
          token,
          expiresAt,
          permission: access,
          space: space.space,
          repo: space.repo,
          epoch: store.get(space.space)!.epoch,
          accessLost: (store.get(space.space) as ServiceSpace).accessLost ?? []
        })
        return
      }
      requireThat(auth?.startsWith('Bearer ') && auth.length < 16384, 'bearer token required', 401)
      const bearer = auth!.slice(7)
      const { token, space } = authenticate(bearer)
      await githubAuth.descriptor(space.repo, publicOrigin, space.space)
      const requestedSpace = method === 'GET' ? requestUrl.searchParams.get('space') : body.space
      requireThat(
        requestedSpace === undefined || requestedSpace === null || requestedSpace === space.space,
        'token space mismatch',
        403
      )
      delete body.space
      if (method === 'GET' && path === '/v1/state') {
        send(200, { ...space, publicAccess: space.publicAccess ?? 'collaborators', accessLost: space.accessLost ?? [] })
        return
      }
      if (method === 'GET' && path === '/v1/relay') {
        requireThat(relays.size < 256, 'relay capacity reached', 503)
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive'
        })
        response.write(': connected\n\n')
        const timer = setTimeout(() => response.end(), token.expiresAt - Date.now())
        relays.set(response, { token: bearer, timer })
        response.on('close', () => {
          clearTimeout(timer)
          relays.delete(response)
        })
        return
      }
      if (method === 'POST' && path === '/v1/keys') {
        exact(body, ['expectedEpoch', 'epoch', 'wraps', 'revoke', 'recoveryPublicKey'])
        const result = await store.update((spaces) => {
          const current = spaces.find((s) => s.space === space.space)! as ServiceSpace
          requireThat(
            !current.revoked.includes(token.device) && !current.accessLost?.includes(token.device),
            'device revoked or access lost',
            403
          )
          requireThat(
            token.permission === 'write' || (body.epoch === current.epoch && current.epoch > 0),
            'write permission required for rotation',
            403
          )
          requireThat(body.expectedEpoch === current.epoch, 'epoch conflict', 409)
          requireThat(
            Number.isSafeInteger(body.epoch) &&
              body.epoch >= 1 &&
              (body.epoch === current.epoch || body.epoch === current.epoch + 1),
            'invalid epoch'
          )
          requireThat(
            Array.isArray(body.wraps) &&
              body.wraps.length <= 1001 &&
              Array.isArray(body.revoke ?? []) &&
              (body.revoke ?? []).every((id: unknown) => typeof id === 'string' && HEX.test(id)),
            'invalid wraps/revocations'
          )
          const revoke: string[] = body.revoke ?? []
          requireThat(!revoke.length || body.epoch === current.epoch + 1, 'revocation requires new epoch')
          requireThat(
            token.permission === 'write' ||
              (body.epoch === current.epoch &&
                !revoke.length &&
                body.recoveryPublicKey === undefined &&
                body.wraps.every((w: unknown) => object(w).deviceId !== 'recovery')),
            'write permission required for rotation/recovery',
            403
          )
          const oldRecovery = current.recoveryPublicKey
          if (body.recoveryPublicKey !== undefined) {
            requireThat(
              base64(body.recoveryPublicKey, 32) &&
                (oldRecovery === body.recoveryPublicKey || current.epoch === 0 || body.epoch === current.epoch + 1),
              'immutable recovery key'
            )
            current.recoveryPublicKey = body.recoveryPublicKey
          }
          const wraps: ShareWrap[] = body.wraps.map((value: unknown) => {
            const w = object(value)
            exact(w, ['epoch', 'deviceId', 'senderId', 'box', 'signature'])
            requireThat(
              w.epoch === body.epoch &&
                w.senderId === token.device &&
                (w.deviceId === 'recovery'
                  ? !!current.recoveryPublicKey
                  : current.devices.some((d) => d.id === w.deviceId)) &&
                !current.revoked.includes(w.deviceId) &&
                !current.accessLost?.includes(w.deviceId) &&
                !revoke.includes(w.deviceId) &&
                base64(w.box) &&
                Buffer.from(w.box, 'base64').length >= 48 &&
                base64(w.signature, 64),
              'invalid wrap or sender binding'
            )
            return w as ShareWrap
          })
          requireThat(new Set(wraps.map((w) => w.deviceId)).size === wraps.length, 'duplicate wrap recipient')
          requireThat(
            !current.recoveryPublicKey || body.epoch === current.epoch || wraps.some((w) => w.deviceId === 'recovery'),
            'new epoch requires recovery wrap'
          )
          for (const w of wraps) {
            const old = current.wraps.find((x) => x.epoch === w.epoch && x.deviceId === w.deviceId)
            requireThat(
              !old ||
                (['epoch', 'deviceId', 'senderId', 'box', 'signature'] as const).every((key) => old[key] === w[key]),
              'immutable epoch wrap',
              409
            )
            if (!old) current.wraps.push(w)
          }
          if (body.epoch > current.epoch)
            current.accessLost = (current.accessLost ?? []).filter((id) => !revoke.includes(id))
          current.epoch = body.epoch
          current.revoked = [...new Set([...current.revoked, ...revoke])]
          requireThat(Buffer.byteLength(JSON.stringify(current)) < LIMIT - 1024, 'space metadata full', 409)
          return current
        })
        disconnectRevoked()
        send(200, result)
        return
      }
      if (method === 'POST' && path === '/v1/rpc') {
        requireThat(['hello', 'head', 'read', 'append', 'hint'].includes(body.op), 'unsupported RPC')
        if (body.op === 'hello') {
          exact(body, ['op', 'require'])
          const b = bridge()
          try {
            const frame = await b.request('hello', { require: ['durable_idempotency', 'bounded_memory_read'] })
            send(200, frame)
          } finally {
            b.close()
            bridges.delete(b)
          }
          return
        }
        requireThat(typeof body.log === 'string' && HEX.test(body.log), 'invalid opaque log')
        const physical = `share-${space.space}-${body.log}`
        const fields: Frame = { log: physical }
        if (body.op === 'append' || body.op === 'hint') {
          exact(body, ['op', 'log', 'idempotency_key', 'payload_hex', 'epoch'])
          requireThat(token.permission === 'write', 'write permission required', 403)
          requireThat(body.epoch === space.epoch && space.epoch > 0, 'stale epoch', 409)
          requireThat(!space.accessLost?.length, 'access loss requires epoch rotation', 409)
          const payload = ciphertext(body.payload_hex, body.epoch, token.device)
          requireThat(
            typeof body.idempotency_key === 'string' && HEX.test(body.idempotency_key),
            'invalid idempotency key'
          )
          const envelope = JSON.parse(Buffer.from(payload, 'hex').toString('utf8'))
          requireThat(envelope.dedup === body.idempotency_key, 'idempotency key must match encrypted dedup')
          fields.idempotency_key = body.idempotency_key
          fields.payload_hex = payload
          for (const [client, relay] of relays) {
            try {
              const other = authenticate(relay.token)
              if (
                other.space.space === space.space &&
                !client.write(`data: ${JSON.stringify({ log: body.log, payload_hex: payload, epoch: body.epoch })}\n\n`)
              )
                client.destroy()
            } catch {
              client.end()
            }
          }
        } else if (body.op === 'read') {
          exact(body, ['op', 'log', 'cursor', 'max_events', 'max_bytes'])
          requireThat(typeof body.cursor === 'string' && /^[1-9][0-9]{0,19}$/.test(body.cursor), 'invalid cursor')
          requireThat(
            body.max_events === undefined ||
              (Number.isInteger(body.max_events) && body.max_events >= 1 && body.max_events <= 128),
            'invalid max_events'
          )
          requireThat(
            body.max_bytes === undefined ||
              (Number.isInteger(body.max_bytes) && body.max_bytes >= 1 && body.max_bytes <= 491520),
            'invalid max_bytes'
          )
          Object.assign(fields, {
            cursor: body.cursor,
            max_events: body.max_events ?? 128,
            max_bytes: body.max_bytes ?? 491520
          })
        } else exact(body, ['op', 'log'])
        if (body.op === 'hint') {
          send(200, { v: 1, op: 'hint', ok: true, log: body.log, accepted: true })
          return
        }
        const run = async () => {
          const current = authenticate(bearer)
          if (body.op === 'append') {
            requireThat(current.space.epoch === body.epoch, 'stale epoch', 409)
            requireThat(!current.space.accessLost?.length, 'access loss requires epoch rotation', 409)
          }
          const b = bridge()
          try {
            await b.hello()
            if (body.op === 'append') {
              // Randomized encryption produces different bytes for the same keyed identity.
              // Coalesce against durable events, never relay hints or an in-memory promise.
              // Pages stay bounded; full-feed scans deliberately trade speed for bounded memory.
              const head = await b.request('head', { log: physical })
              requireThat(
                head.log === physical && typeof head.cursor === 'string' && /^[1-9][0-9]*$/.test(head.cursor),
                'invalid durable feed head',
                502
              )
              const limit = BigInt(head.cursor as string)
              let cursor = 1n
              while (cursor < limit) {
                const count = Number(limit - cursor > 128n ? 128n : limit - cursor)
                const page = await b.request('read', {
                  log: physical,
                  cursor: String(cursor),
                  max_events: count,
                  max_bytes: 491520
                })
                requireThat(
                  page.log === physical &&
                    Array.isArray(page.events) &&
                    page.events.length > 0 &&
                    page.events.length <= count,
                  'invalid durable feed page',
                  502
                )
                for (const raw of page.events as unknown[]) {
                  const event = object(raw)
                  requireThat(
                    event.seq === String(cursor) &&
                      typeof event.payload_hex === 'string' &&
                      /^(?:[a-f0-9]{2})+$/.test(event.payload_hex),
                    'invalid durable event',
                    502
                  )
                  let record: Record<string, any>
                  try {
                    record = JSON.parse(Buffer.from(event.payload_hex, 'hex').toString('utf8'))
                  } catch {
                    throw new HttpError(502, 'invalid durable ciphertext record')
                  }
                  if (record?.dedup === body.idempotency_key && record.epoch === body.epoch) {
                    const latest = authenticate(bearer).space
                    requireThat(
                      latest.epoch === body.epoch && !latest.accessLost?.length,
                      'epoch rotation required',
                      409
                    )
                    return {
                      v: 1,
                      id: head.id,
                      op: 'append',
                      ok: true,
                      log: body.log,
                      first: String(cursor),
                      last: String(cursor),
                      cursor: String(cursor + 1n)
                    }
                  }
                  cursor++
                }
                requireThat(page.next_cursor === String(cursor), 'invalid durable page cursor', 502)
              }
              const latest = authenticate(bearer).space
              requireThat(latest.epoch === body.epoch && !latest.accessLost?.length, 'epoch rotation required', 409)
            }
            const frame = await b.request(body.op, fields)
            if (body.op === 'append') validateAppendReceipt(frame, physical)
            return { ...frame, log: body.log }
          } finally {
            await b.finish()
            bridges.delete(b)
          }
        }
        let result: Frame
        if (body.op === 'append') {
          const previous = queues.get(physical) ?? Promise.resolve()
          const pending = previous.catch(() => {}).then(run)
          queues.set(physical, pending)
          try {
            result = await pending
          } finally {
            if (queues.get(physical) === pending) queues.delete(physical)
          }
        } else result = await run()
        send(200, result)
        return
      }
      throw new HttpError(404, 'unknown endpoint')
    } catch (error) {
      if (!response.headersSent)
        send(error instanceof HttpError || error instanceof ShareAuthError ? error.status : 502, {
          error:
            error instanceof HttpError || error instanceof ShareAuthError
              ? error.message
              : 'share service operation failed'
        })
      else response.end()
    }
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  server.maxConnections = 512
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(config.port ?? 0, config.host ?? '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
  } catch (error) {
    release()
    throw error
  }
  active.add(stateDir)
  const address = server.address() as { address: string; port: number }
  const host = address.address.includes(':') ? `[${address.address}]` : address.address
  publicOrigin ||= `http://${host}:${address.port}`
  return {
    server,
    url: `http://${host}:${address.port}`,
    close: async () => {
      if (closing) return
      closing = true
      clearInterval(descriptorTimer)
      for (const [response, relay] of relays) {
        clearTimeout(relay.timer)
        response.end()
      }
      for (const b of bridges) b.close()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeIdleConnections()
      })
      tokens.clear()
      active.delete(stateDir)
      release()
    }
  }
}

/** Metadata-only export; stop service and snapshot Comb separately (including S3 data).
 * See BACKUP.json for restore instructions. Never includes design keys or storage credentials. */
export async function backupShareService(config: ShareServiceConfig, destination: string): Promise<void> {
  requireThat(!active.has(resolve(config.stateDir)), 'stop service before metadata backup', 409)
  const release = acquireDocumentLock(join(resolve(config.stateDir), 'service'), 100)
  try {
    requireThat(config.backupLocalStore, 'backupLocalStore required: metadata alone is not a store backup')
    const output = resolve(destination)
    for (const source of [resolve(config.stateDir), resolve(config.backupLocalStore!)])
      requireThat(
        output !== source && !output.startsWith(source + sep),
        'backup destination must be outside source stores'
      )
    await backupShareMetadata(config.stateDir, destination)
    try {
      await cp(config.backupLocalStore, join(destination, 'comb-store'), {
        recursive: true,
        errorOnExist: true,
        force: false
      })
      await writeFile(
        join(destination, 'BACKUP.json'),
        JSON.stringify({
          version: 1,
          scope: 'complete-local-store',
          backendIncluded: true,
          requiresStoppedService: true,
          restore:
            'Restore metadata.json to stateDir and comb-store to the configured local backend root. Restore matching tenant/digest/storage config from your separate secret backup before starting.'
        }),
        { mode: 0o600 }
      )
    } catch (error) {
      await rm(destination, { recursive: true, force: true })
      throw error
    }
  } finally {
    release()
  }
}
