import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export interface ShareConfig {
  version: 1
  mode: 'self-hosted' | 'hosted'
  service: string
  space: string
  repo: string
  encryption: 'e2e-v1'
  recoveryPublicKey?: string
  publicAccess?: 'repo-read' | 'collaborators'
}
export function serviceUrl(value: string): string {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('share service must be an origin without credentials')
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))
  )
    throw new Error('share service requires HTTPS (loopback HTTP is allowed for local testing)')
  return url.origin
}
export function readShareConfig(root: string): ShareConfig | null {
  const file = join(root, '.foundation/share.json')
  if (!existsSync(file)) return null
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  if (raw.version !== 1) throw new Error('unsupported share.json version')
  if (raw.mode === 'git-only') return null
  if(raw.publicAccess!==undefined&&!['repo-read','collaborators'].includes(raw.publicAccess))throw new Error('invalid share public access policy')
  if (
    !['self-hosted', 'hosted'].includes(raw.mode) ||
    raw.encryption !== 'e2e-v1' ||
    !/^sp_[A-Za-z0-9_-]+$/.test(raw.space) ||
    !/^github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw.repo)
  )
    throw new Error('invalid share.json; e2e-v1 is required')
  return {
    version: 1,
    mode: raw.mode,
    service: serviceUrl(raw.service),
    space: raw.space,
    repo: raw.repo,
    encryption: 'e2e-v1',
    recoveryPublicKey: raw.recoveryPublicKey,
    publicAccess: raw.publicAccess ?? 'collaborators'
  }
}
export function findShareRoot(path: string): string | null {
  let dir = resolve(path)
  for (;;) {
    if (existsSync(join(dir, '.foundation/share.json'))) return dir
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}
