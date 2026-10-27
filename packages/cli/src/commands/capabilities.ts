import { spawnSync } from 'node:child_process'
import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from '../argv.js'
import type { CliIO } from '../io.js'
import { inspect } from '../runtime-inventory.js'

export interface NodeCapabilities {
  capabilitiesVersion: 1
  node: string
  foundation: {
    installed: boolean
    path: string | null
    sourceSha: string | null
    sessionProtocols: string[] | null
    documentFormats: string[] | null
    artboardWriteSafe: boolean | null
    quickrefPath: string | null
  }
  checkout: {
    present: boolean
    repoRoot: string | null
    head: string | null
    designPath?: string
    designPresent?: boolean
  }
}

function accessible(path: string, directory = false): boolean {
  try {
    const stat = statSync(path)
    if (directory ? !stat.isDirectory() : !stat.isFile()) return false
    accessSync(path, constants.R_OK | (directory ? constants.X_OK : 0))
    return true
  } catch { return false }
}

function installedFoundation(selectedPath?: string): NodeCapabilities['foundation'] {
  const home = process.env.HOME || homedir()
  const candidates = selectedPath ? [selectedPath] : [...new Set((process.env.PATH || '').split(delimiter).filter(Boolean).map(dir => resolve(dir, 'foundation')).concat(join(home, '.local/bin/foundation')))]
  for (const candidate of candidates) {
    const entry = inspect(candidate, 'capabilities')
    if (!entry.executable || !entry.realpath) continue
    const quickref = entry.stampPath ? join(dirname(entry.stampPath), 'packages/cli/skills/foundation-edit/SKILL.md') : null
    let quickrefPath: string | null = null
    try { if (quickref && accessible(quickref)) quickrefPath = realpathSync(quickref) } catch {}
    return { installed: true, path: entry.realpath, sourceSha: entry.sourceSha, sessionProtocols: entry.sessionProtocols,
      documentFormats: entry.documentFormats, artboardWriteSafe: entry.artboardWriteSafe === 'unknown' ? null : entry.artboardWriteSafe,
      quickrefPath }
  }
  return { installed: false, path: null, sourceSha: null, sessionProtocols: null, documentFormats: null, artboardWriteSafe: null, quickrefPath: null }
}

function checkoutCapabilities(productRoot?: string, designPath?: string): NodeCapabilities['checkout'] {
  const checkout: NodeCapabilities['checkout'] = { present: false, repoRoot: null, head: null,
    ...(designPath ? { designPath, designPresent: false } : {}) }
  if (!productRoot || !accessible(productRoot, true)) return checkout
  let root: string
  try { root = realpathSync(productRoot) } catch { return checkout }
  checkout.present = true
  checkout.repoRoot = root
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key]
  const git = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel', 'HEAD'], {
    env: { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }, encoding: 'utf8', timeout: 100, maxBuffer: 32 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
  })
  if (!git.error) {
    const [repo, head] = git.stdout.trim().split('\n')
    if (repo && isAbsolute(repo)) checkout.repoRoot = repo
    if (git.status === 0 && head && /^[a-f0-9]{40,64}$/i.test(head)) checkout.head = head
  }
  if (designPath && accessible(designPath)) {
    try {
      const file = realpathSync(designPath)
      const within = relative(root, file)
      checkout.designPresent = within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within)
    } catch {}
  }
  return checkout
}

export async function runCapabilities(args: string[], io: CliIO): Promise<number> {
  const { flags, positionals } = parseArgs(args)
  const productRoot = flags['product-root'], designPath = flags['design-path'], foundationPath = flags['foundation-path']
  if (flags.capabilities !== true || flags.json !== true || positionals.length
    || Object.keys(flags).some(key => !['capabilities', 'json', 'product-root', 'design-path', 'foundation-path'].includes(key))
    || (productRoot !== undefined && (typeof productRoot !== 'string' || !isAbsolute(productRoot)))
    || (designPath !== undefined && (typeof designPath !== 'string' || !isAbsolute(designPath) || !productRoot))
    || (foundationPath !== undefined && (typeof foundationPath !== 'string' || !isAbsolute(foundationPath)))) {
    io.stderr('usage: foundation doctor --capabilities --json [--product-root ABS] [--design-path ABS] [--foundation-path ABS]')
    return 2
  }
  const result: NodeCapabilities = { capabilitiesVersion: 1, node: process.env.FOUNDATION_NODE_ID || hostname(),
    foundation: installedFoundation(typeof foundationPath === 'string' ? foundationPath : undefined), checkout: checkoutCapabilities(typeof productRoot === 'string' ? productRoot : undefined, typeof designPath === 'string' ? designPath : undefined) }
  io.stdout(JSON.stringify(result))
  return 0
}
