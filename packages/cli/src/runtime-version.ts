import { defaultChainFormat } from './chain-format.js'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface RuntimeVersion {
  sourceSha: string
  dirty: boolean | null
  packageVersion: string
  sessionProtocols: string[]
  documentFormats: string[]
  chainFormats: number[]
  defaultChainFormat: 1 | 2
  artboardWriteSafe: boolean
}
export const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
export function runtimeVersion(root = existsSync(resolve(sourceRoot, 'packages/cli/package.json')) ? sourceRoot : process.env.FDN_ROOT || sourceRoot): RuntimeVersion {
  try { const runtime = JSON.parse(readFileSync(resolve(root, 'foundation-install.json'), 'utf8')).runtime; return { ...runtime, chainFormats: runtime.chainFormats ?? [1], defaultChainFormat: defaultChainFormat() } } catch {}
  let sourceSha = 'unknown'
  let dirty: boolean | null = null
  // Archive releases have no Git metadata; never discover a surrounding repo.
  if (existsSync(resolve(root, '.git'))) try {
    sourceSha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    dirty = !!execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim()
  } catch {}
  let packageVersion = 'unknown'
  try { packageVersion = JSON.parse(readFileSync(resolve(root, 'packages/cli/package.json'), 'utf8')).version } catch {}
  return { sourceSha, dirty, packageVersion, sessionProtocols: ['0.2', '0.1'], documentFormats: ['0.1.0-artboards', '0.0.1-draft', '0.1.0', '0.2.0'], artboardWriteSafe: true, chainFormats: [1, 2], defaultChainFormat: defaultChainFormat() }
}
