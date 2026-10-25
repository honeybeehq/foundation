import { createPrivateKey, createSign } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'

export interface GithubAppConfig {
  appId: number
  slug: string
  clientId: string
  privateKey: string
}

export const defaultGithubAppPath = `${homedir()}/.foundation/share-service/github-app.json`

export function parseGithubAppConfig(value: unknown): GithubAppConfig {
  if (!value || typeof value !== 'object') throw new Error('Invalid GitHub App config')
  const v = value as Record<string, unknown>
  if (!Number.isSafeInteger(v.appId) || Number(v.appId) <= 0 || typeof v.slug !== 'string' || !/^[a-z0-9-]+$/.test(v.slug) || typeof v.clientId !== 'string' || !v.clientId || typeof v.privateKey !== 'string') throw new Error('Invalid GitHub App config')
  try {
    if (createPrivateKey(v.privateKey).asymmetricKeyType !== 'rsa') throw new Error()
  } catch { throw new Error('GitHub App config requires an RSA private key') }
  return { appId: Number(v.appId), slug: v.slug, clientId: v.clientId, privateKey: v.privateKey }
}

export async function readGithubAppConfig(path: string): Promise<GithubAppConfig> {
  const info = await stat(path)
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error('GitHub App config must be a private file (chmod 600)')
  const raw = await readFile(path, 'utf8')
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('Invalid JSON in private GitHub App config') }
  return parseGithubAppConfig(value)
}

export function githubRepo(repo: string): string {
  const value = repo.replace(/^github\.com\//, '')
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(value) || value.split('/').some(part => part === '.' || part === '..')) throw new Error('Expected GitHub repo owner/name')
  return value
}

export function appJwt(config: GithubAppConfig): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(config.appId) })).toString('base64url')
  const payload = `${header}.${body}`
  return `${payload}.${createSign('RSA-SHA256').update(payload).sign(config.privateKey, 'base64url')}`
}

export async function githubRequest(path: string, token?: string, method = 'GET', body?: unknown, fetcher: typeof fetch = fetch): Promise<Response> {
  try {
    return await fetcher(`https://api.github.com${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'foundation-share', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch { throw new Error('GitHub request failed; check network connectivity') }
}

export async function githubJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`GitHub request refused (HTTP ${response.status})`)
  try {
    const value: unknown = await response.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value as Record<string, unknown>
  } catch { throw new Error('GitHub returned an invalid response') }
}

export function requireMetadataOnly(permissions: unknown): void {
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions) || Object.entries(permissions).some(([key, value]) => key !== 'metadata' || value !== 'read') || (permissions as Record<string, unknown>).metadata !== 'read') throw new Error('GitHub App must have only Metadata: read permission; remove all other permissions')
}

const tokens = new Map<string, { token: string; expires: number }>()

export async function mintMetadataToken(repo: string, config: GithubAppConfig, fetcher: typeof fetch = fetch): Promise<{ token: string; expires: number }> {
  const jwt = appJwt(config)
  const app = await githubJson(await githubRequest('/app', jwt, 'GET', undefined, fetcher))
  requireMetadataOnly(app.permissions)
  const installation = await githubJson(await githubRequest(`/repos/${githubRepo(repo)}/installation`, jwt, 'GET', undefined, fetcher))
  if (!Number.isSafeInteger(installation.id)) throw new Error('GitHub returned an invalid installation')
  requireMetadataOnly(installation.permissions)
  const result = await githubJson(await githubRequest(`/app/installations/${installation.id}/access_tokens`, jwt, 'POST', { permissions: { metadata: 'read' }, repositories: [githubRepo(repo).split('/')[1]] }, fetcher))
  requireMetadataOnly(result.permissions)
  const expires = typeof result.expires_at === 'string' ? Date.parse(result.expires_at) : NaN
  if (typeof result.token !== 'string' || !result.token || !Number.isFinite(expires) || expires <= Date.now() + 60_000) throw new Error('GitHub returned an invalid installation token')
  return { token: result.token, expires }
}

export async function metadataToken(repo: string, configPath: string): Promise<string> {
  const normalized = githubRepo(repo)
  const config = await readGithubAppConfig(configPath)
  const key = `${configPath}:${config.appId}:${normalized}`
  const cached = tokens.get(key)
  if (cached && cached.expires > Date.now() + 60_000) return cached.token
  const minted = await mintMetadataToken(normalized, config)
  tokens.set(key, minted)
  return minted.token
}

export async function checkContentsRefusal(repo: string, config: GithubAppConfig, token: string, fetcher: typeof fetch = fetch): Promise<string> {
  const normalized = githubRepo(repo)
  const response = await githubRequest(`/repos/${normalized}/contents/`, token, 'GET', undefined, fetcher)
  if (response.status === 403) {
    const denied = await response.json().catch(() => null)
    if (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after') || denied?.message !== 'Resource not accessible by integration') throw new Error('Contents refusal not proven; GitHub returned an unrelated restriction')
    return 'Contents request refused: HTTP 403 (Resource not accessible by integration)'
  }
  if (response.status !== 200) throw new Error(`Contents refusal not proven (HTTP ${response.status}); retry after checking repository access`)
  const jwt = appJwt(config)
  const installation = await githubJson(await githubRequest(`/repos/${normalized}/installation`, jwt, 'GET', undefined, fetcher))
  if (!Number.isSafeInteger(installation.id)) throw new Error('GitHub returned an invalid installation')
  const attempt = await githubRequest(`/app/installations/${installation.id}/access_tokens`, jwt, 'POST', { permissions: { contents: 'read' }, repositories: [normalized.split('/')[1]] }, fetcher)
  if (attempt.status !== 422) {
    if (attempt.ok) {
      const granted = await githubJson(attempt)
      if (typeof granted.token === 'string') await githubRequest('/installation/token', granted.token, 'DELETE', undefined, fetcher)
    }
    throw new Error(`Contents permission refusal not proven (HTTP ${attempt.status}); expected 422`)
  }
  const denied = await attempt.json().catch(() => null)
  if (attempt.headers.has('retry-after') || typeof denied?.message !== 'string' || !/permissions requested are not granted to this installation/i.test(denied.message)) throw new Error('Contents permission refusal not proven; GitHub returned an unrelated validation error')
  return 'Public contents readable without Contents permission. Contents permission request refused: HTTP 422 (permissions not granted)'
}
