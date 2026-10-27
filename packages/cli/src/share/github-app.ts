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

export const shareDescriptorPath = '.foundation/share.json'

export function requireSharePermissions(permissions: unknown): boolean {
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) throw new Error('Invalid GitHub App permissions')
  const grants = permissions as Record<string, unknown>
  if (grants.metadata !== 'read' || Object.entries(grants).some(([key, value]) => !['metadata', 'single_file'].includes(key) || value !== 'read')) throw new Error('GitHub App may grant only Metadata: read and Single file: read; no Contents or other permissions')
  return grants.single_file === 'read'
}

export function requireDescriptorPath(installation: Record<string, unknown>): void {
  const name = installation.single_file_name
  const paths = installation.single_file_paths
  if (installation.has_multiple_single_files === true || (name != null && name !== shareDescriptorPath) || (paths !== undefined && (!Array.isArray(paths) || paths.some(path => path !== shareDescriptorPath) || paths.length > 1)) || (name !== shareDescriptorPath && (!Array.isArray(paths) || paths.length !== 1))) throw new Error(`Single file permission must be limited to exactly ${shareDescriptorPath}`)
}

const tokens = new Map<string, { token: string; expires: number; singleFile: boolean }>()

export async function mintMetadataToken(repo: string, config: GithubAppConfig, fetcher: typeof fetch = fetch): Promise<{ token: string; expires: number; singleFile: boolean }> {
  const jwt = appJwt(config)
  const app = await githubJson(await githubRequest('/app', jwt, 'GET', undefined, fetcher))
  const appSingleFile = requireSharePermissions(app.permissions)
  const installation = await githubJson(await githubRequest(`/repos/${githubRepo(repo)}/installation`, jwt, 'GET', undefined, fetcher))
  if (!Number.isSafeInteger(installation.id)) throw new Error('GitHub returned an invalid installation')
  const singleFile = requireSharePermissions(installation.permissions)
  if (singleFile && !appSingleFile) throw new Error('GitHub App and installation permissions disagree')
  if (singleFile) requireDescriptorPath(installation)
  const permissions = singleFile ? { metadata: 'read', single_file: 'read' } : { metadata: 'read' }
  const result = await githubJson(await githubRequest(`/app/installations/${installation.id}/access_tokens`, jwt, 'POST', { permissions, repositories: [githubRepo(repo).split('/')[1]] }, fetcher))
  if (requireSharePermissions(result.permissions) !== singleFile) throw new Error('Minted token permissions do not match requested permissions')
  const expires = typeof result.expires_at === 'string' ? Date.parse(result.expires_at) : NaN
  if (typeof result.token !== 'string' || !result.token || !Number.isFinite(expires) || expires <= Date.now() + 60_000) throw new Error('GitHub returned an invalid installation token')
  return { token: result.token, expires, singleFile }
}

export async function checkSingleFileRead(repo: string, token: string, fetcher: typeof fetch = fetch): Promise<string> {
  const normalized = githubRepo(repo)
  const repository = await githubJson(await githubRequest(`/repos/${normalized}`, token, 'GET', undefined, fetcher))
  if (typeof repository.private !== 'boolean') throw new Error('GitHub returned no repository visibility')
  const response = await githubRequest(`/repos/${normalized}/contents/${shareDescriptorPath}`, token, 'GET', undefined, fetcher)
  if (response.status === 404) throw new Error(`No committed ${shareDescriptorPath} on the default branch, or the Single file grant does not cover it`)
  const result = await githubJson(response)
  if (result.path !== shareDescriptorPath || result.type !== 'file' || result.encoding !== 'base64' || typeof result.content !== 'string' || typeof result.size !== 'number' || result.size > 65_536 || result.size <= 0 || result.content.length > 90_000) throw new Error('GitHub returned an invalid or oversized share descriptor')
  const bytes = Buffer.from(result.content, 'base64')
  if (bytes.length !== result.size) throw new Error('GitHub share descriptor size mismatch')
  let descriptor: unknown
  try { descriptor = JSON.parse(bytes.toString('utf8')) } catch { throw new Error('Committed share descriptor is not JSON') }
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor) || (descriptor as Record<string, unknown>).version !== 1) throw new Error('Committed share descriptor must be a version 1 object')
  return repository.private
    ? `Private single-file read allowed: ${shareDescriptorPath} on the default branch (HTTP 200)`
    : `Descriptor readable (public): ${shareDescriptorPath} (HTTP 200); Single file scope verified by installation grant, not this public read`
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
