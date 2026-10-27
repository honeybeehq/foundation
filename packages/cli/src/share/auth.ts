import { createPublicKey, randomBytes, verify } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { metadataToken } from './github-app.js'
import type { ShareDevice } from './service-store.js'

export class ShareAuthError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}
export type PublicAccess = 'repo-read' | 'collaborators'
interface Challenge {
  action: 'create' | 'token'
  space: string
  repo: string
  expiresAt: number
}
/** Only the operator's metadata permission credential crosses this boundary, never a user's token. */
export class ShareAuth {
  private challenges = new Map<string, Challenge>()
  private inFlight = 0
  constructor(private config: { githubApiUrl?: string; githubPermissionToken?: string; githubAppConfig?: string }) {}
  challenge(action: Challenge['action'], space: string, repo: string) {
    for (const [key, value] of this.challenges) if (value.expiresAt <= Date.now()) this.challenges.delete(key)
    if (this.challenges.size >= 4096) throw new ShareAuthError(503, 'challenge capacity reached')
    const challenge = randomBytes(32).toString('base64url')
    const value = { action, space, repo, expiresAt: Date.now() + 60000 }
    this.challenges.set(challenge, value)
    return { challenge, space, repo, expiresAt: value.expiresAt }
  }
  consume(challenge: unknown, action: Challenge['action']): Challenge {
    if (typeof challenge !== 'string') throw new ShareAuthError(401, 'challenge required')
    const value = this.challenges.get(challenge)
    this.challenges.delete(challenge) // a failed attempt consumes the nonce too
    if (!value || value.action !== action || value.expiresAt <= Date.now())
      throw new ShareAuthError(401, 'invalid or expired challenge')
    return value
  }
  private async request(path: string, keys = false, repo?: string): Promise<{ status: number; text: string }> {
    const origin = this.config.githubApiUrl ?? (keys ? 'https://github.com' : 'https://api.github.com')
    const headers: Record<string, string> = {
      'User-Agent': 'foundation-share',
      Accept: keys ? 'text/plain' : 'application/vnd.github+json'
    }
    if (!keys) {
      let token = this.config.githubPermissionToken
      if (this.config.githubAppConfig && repo) {
        try { token = await metadataToken(repo, this.config.githubAppConfig) }
        catch (error) {
          // Only fixed provider diagnostics enter the journal, never arbitrary errors/keys.
          const message = error instanceof Error ? error.message : ''
          const diagnostic = /^GitHub request refused \(HTTP [0-9]{3}\)$/.test(message) ||
            ['GitHub App must have only Metadata: read permission; remove all other permissions',
             'GitHub App config must be a private file (chmod 600)',
             'Invalid JSON in private GitHub App config', 'Invalid GitHub App config',
             'GitHub App config requires an RSA private key',
             'GitHub request failed; check network connectivity',
             'GitHub returned an invalid response', 'GitHub returned an invalid installation',
             'GitHub returned an invalid installation token'].includes(message)
            ? message : 'credential provider failed'
          console.error(`Share GitHub App: ${diagnostic}`)
          throw new ShareAuthError(502, 'GitHub App metadata credential unavailable')
        }
      }
      if (token) headers.Authorization = `Bearer ${token}`
    }
    let response: Response
    try {
      response = await fetch(origin + path, { headers, redirect: 'error', signal: AbortSignal.timeout(10000) })
    } catch {
      throw new ShareAuthError(502, 'GitHub verification unavailable')
    }
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of response.body!) {
      size += chunk.length
      if (size > (keys ? 65536 : 2097152)) {
        throw new ShareAuthError(502, 'GitHub verification response too large')
      }
      chunks.push(chunk)
    }
    return { status: response.status, text: Buffer.concat(chunks).toString('utf8') }
  }
  private async json(path: string, repo?: string) {
    const response = await this.request(path, false, repo)
    if (response.status !== 200) throw new ShareAuthError(502, 'GitHub verification unavailable')
    try {
      return JSON.parse(response.text) as Record<string, any>
    } catch {
      throw new ShareAuthError(502, 'invalid GitHub verification response')
    }
  }
  private descriptors = new Map<string, number>()
  /** Omitted ref means GitHub's default branch; never follow a supplied download URL. */
  async descriptor(repo: string, service: string, space: string): Promise<void> {
    const key = JSON.stringify([repo, service, space])
    if (Date.now() - (this.descriptors.get(key) ?? 0) < 30000) return
    const result = await this.request(`/repos/${repo.slice(11)}/contents/.foundation/share.json`, false, repo)
    if (result.status !== 200)
      throw new ShareAuthError(412, 'Commit .foundation/share.json naming this service and space to the repository default branch before enabling live sharing (App single-file read permission required)')
    let descriptor: Record<string, unknown>
    try {
      const file = JSON.parse(result.text)
      if (file.type !== 'file' || file.path !== '.foundation/share.json' || file.encoding !== 'base64' || typeof file.content !== 'string' || file.content.length > 65536) throw new Error('invalid descriptor file')
      const encoded = file.content.replace(/\s/g, '')
      const bytes = Buffer.from(encoded, 'base64')
      if (bytes.length > 32768 || bytes.toString('base64') !== encoded) throw new Error('invalid descriptor encoding')
      descriptor = JSON.parse(bytes.toString('utf8'))
    } catch { throw new ShareAuthError(412, 'Default-branch .foundation/share.json must be a valid regular JSON file') }
    if (!descriptor || descriptor.version !== 1 || !['self-hosted', 'hosted'].includes(String(descriptor.mode)) || descriptor.encryption !== 'e2e-v1' || descriptor.repo !== repo || descriptor.service !== service || descriptor.space !== space)
      throw new ShareAuthError(412, 'Default-branch .foundation/share.json does not authorize this service and space')
    if (this.descriptors.size >= 4096) this.descriptors.delete(this.descriptors.keys().next().value!)
    this.descriptors.set(key, Date.now())
  }
  async verifyDevice(
    device: ShareDevice,
    repo: string,
    space: string,
    challenge: string,
    proof: unknown
  ): Promise<void> {
    if (this.inFlight >= 16) throw new ShareAuthError(503, 'verification capacity reached')
    if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(device.login)) throw new ShareAuthError(400, 'invalid GitHub login')
    if (typeof proof !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(proof))
      throw new ShareAuthError(401, 'invalid device proof')
    const publicKey = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(device.signPublicKey, 'base64')]),
      format: 'der',
      type: 'spki'
    })
    const message = JSON.stringify(['foundation-auth-v1', device.service, space, device.id, challenge])
    if (!verify(null, Buffer.from(message), publicKey, Buffer.from(proof, 'base64')))
      throw new ShareAuthError(401, 'invalid device proof')
    this.inFlight++
    try {
      const identity = await this.json(`/users/${device.login}`, repo)
      if (
        identity.id !== device.githubId ||
        typeof identity.login !== 'string' ||
        identity.login.toLowerCase() !== device.login.toLowerCase()
      )
        throw new ShareAuthError(403, 'GitHub identity mismatch')
      const keys = await this.request(`/${device.login}.keys`, true)
      if (keys.status !== 200) throw new ShareAuthError(502, 'GitHub SSH keys unavailable')
      const lines = keys.text.trim().split('\n')
      if (
        !lines.length ||
        lines.length > 100 ||
        lines.some(
          (k) =>
            !/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh.com|sk-ecdsa-sha2-nistp256@openssh.com) [A-Za-z0-9+/=]+(?: [^\r\n]*)?$/.test(
              k
            )
        )
      )
        throw new ShareAuthError(403, 'invalid GitHub SSH keys')
      const canonical = JSON.stringify([
        'foundation-device-v1',
        device.service,
        space,
        repo,
        device.login,
        device.githubId,
        device.boxPublicKey,
        device.signPublicKey
      ])
      const directory = await mkdtemp(join(tmpdir(), 'foundation-share-auth-'))
      try {
        const allowed = join(directory, 'allowed_signers'),
          signature = join(directory, 'statement.sig')
        await writeFile(
          allowed,
          lines
            .map((key) => `${device.login} namespaces="foundation-share" ${key.split(/\s+/).slice(0, 2).join(' ')}`)
            .join('\n') + '\n',
          { mode: 0o600 }
        )
        await writeFile(signature, device.signature, { mode: 0o600 })
        const valid = await new Promise<boolean>((resolve, reject) => {
          const child = spawn(
            'ssh-keygen',
            ['-Y', 'verify', '-f', allowed, '-I', device.login, '-n', 'foundation-share', '-s', signature],
            { stdio: ['pipe', 'ignore', 'ignore'] }
          )
          const timer = setTimeout(() => {
            child.kill()
            resolve(false)
          }, 5000)
          child.once('error', () => {
            clearTimeout(timer)
            reject(new ShareAuthError(502, 'SSH verifier unavailable'))
          })
          child.once('exit', (code) => {
            clearTimeout(timer)
            resolve(code === 0)
          })
          child.stdin.on('error', () => {})
          child.stdin.end(canonical)
        })
        if (!valid) throw new ShareAuthError(403, 'invalid GitHub SSH device signature')
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    } finally {
      this.inFlight--
    }
  }
  async permission(repo: string, login: string, publicAccess: PublicAccess): Promise<'read' | 'write' | 'none'> {
    const path = `/repos/${repo.slice('github.com/'.length)}`
    const metadata = await this.json(path, repo)
    if (metadata.private === false && publicAccess === 'repo-read')
      throw new ShareAuthError(400, 'Public repositories require collaborators and organization members; repo-read is only allowed for private repositories')
    if (!this.config.githubPermissionToken && !this.config.githubAppConfig && !this.config.githubApiUrl) {
      throw new ShareAuthError(503, 'service metadata permission credential required')
    }
    const response = await this.request(`${path}/collaborators/${login}/permission`, false, repo)
    if (response.status === 404 || (metadata.private === false && publicAccess === 'collaborators')) {
      for (let page = 1; page <= 1000; page++) {
        const list = await this.request(`${path}/collaborators?affiliation=all&per_page=100&page=${page}`, false, repo)
        if (list.status !== 200) throw new ShareAuthError(502, 'Cannot confirm collaborator removal')
        const users = JSON.parse(list.text) as {
          login: string
          permissions?: { push?: boolean; admin?: boolean; maintain?: boolean }
        }[]
        if (!Array.isArray(users)) throw new ShareAuthError(502, 'Invalid collaborators response')
        const user = users.find((u) => u.login.toLowerCase() === login.toLowerCase())
        if (user)
          return user.permissions?.push || user.permissions?.admin || user.permissions?.maintain ? 'write' : 'read'
        if (users.length < 100) return 'none'
      }
      throw new ShareAuthError(502, 'Collaborator listing exceeded bound')
    }
    if (response.status !== 200) {
      throw new ShareAuthError(502, 'GitHub collaborator permission unavailable')
    }
    let permission: unknown
    try {
      permission = JSON.parse(response.text).permission
    } catch {
      throw new ShareAuthError(502, 'invalid GitHub permission response')
    }
    if (['admin', 'maintain', 'write', 'push'].includes(String(permission))) return 'write'
    if (['read', 'pull', 'triage'].includes(String(permission))) return 'read'
    if (permission === 'none') return 'none'
    throw new ShareAuthError(502, 'unknown GitHub permission')
  }
}
