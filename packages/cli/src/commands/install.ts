import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, lstatSync, readlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { CliIO } from '../io.js'
import { parseArgs, flagString } from '../argv.js'
import { sourceRoot } from '../runtime-version.js'
import { gatewayRegistryPath, writeGatewayRegistry, readGatewayRegistry } from '../mcp/gatewayRegistry.js'

export async function runInstall(args: string[], io: CliIO): Promise<number> {
  const { flags, positionals } = parseArgs(args)
  if (positionals.length || Object.keys(flags).some((key) => !['from', 'sha', 'force', 'dry-run', 'rollback'].includes(key))
      || (flags.from !== undefined && typeof flags.from !== 'string')
      || (flags.sha !== undefined && (typeof flags.sha !== 'string' || !/^[a-f0-9]{7,40}$/i.test(flags.sha)))
      || ['force', 'dry-run', 'rollback'].some(key => flags[key] !== undefined && flags[key] !== true)
      || (flags.rollback && (flags.from || flags.sha || flags.force))) {
    io.stderr('usage: foundation install [--from CHECKOUT] [--sha SHA] [--force] [--dry-run] | --rollback [--dry-run]')
    return 2
  }
  const home = process.env.HOME || homedir()
  if (flags.rollback) return rollbackInstall(home, flags['dry-run'] === true, io)
  const from = resolve(flagString(flags, 'from') || process.env.FDN_ROOT || sourceRoot)
  if (!existsSync(join(from, '.git'))) { io.stderr('Install requires --from pointing to a Git checkout root.'); return 2 }
  const git = (...argv: string[]) => execFileSync('git', ['-C', from, ...argv], { encoding: 'utf8' }).trim()
  const sha = git('rev-parse', '--verify', `${flagString(flags, 'sha') || 'HEAD'}^{commit}`)
  const base = join(home, '.local/share/foundation')
  const target = join(base, 'versions', sha)
  const current = join(base, 'current')
  let previous: string | undefined
  try { previous = JSON.parse(readFileSync(join(current, 'foundation-install.json'), 'utf8')).runtime.sourceSha } catch {}
  if (previous && previous !== sha && !flags.force) {
    try { git('merge-base', '--is-ancestor', previous, sha) } catch {
      io.stderr('Refusing a downgrade or unrelated revision; use --force to replace it.')
      return 1
    }
  }
  const plan = installPlan(target, home, sha, previous)
  if (flags['dry-run']) { io.stdout(JSON.stringify(plan, null, 2)); return 0 }
  mkdirSync(dirname(target), { recursive: true })
  const lock = join(base, 'install.lock')
  try { mkdirSync(lock) } catch { io.stderr(`Another install may be active; inspect ${lock} before retrying.`); return 1 }
  try {
  let lockedPrevious: string | undefined
  try { lockedPrevious = JSON.parse(readFileSync(join(current, 'foundation-install.json'), 'utf8')).runtime.sourceSha } catch {}
  if (lockedPrevious !== previous) { io.stderr('Current release changed during planning; rerun install.'); return 1 }
  if (!existsSync(join(target, 'foundation-install.json'))) {
    const stage = `${target}.${process.pid}.tmp`
    mkdirSync(stage, { recursive: true })
    try {
      const archive = execFileSync('git', ['-C', from, 'archive', sha], { maxBuffer: 128 * 1024 * 1024 })
      execFileSync('tar', ['-x', '-C', stage], { input: archive })
      if (!existsSync(join(stage, 'packages/cli/src/runtime-version.ts'))) throw new Error('This revision predates runtime attestation; choose a revision supporting foundation version.')
      execFileSync('pnpm', ['install', '--frozen-lockfile'], { cwd: stage, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 })
      execFileSync(process.execPath, ['--input-type=module', '-e', `import {build} from 'esbuild'; await build({entryPoints:['src/session/bin.ts'],bundle:true,platform:'node',format:'esm',target:'node22',external:['loro-crdt'],outfile:'dist/session.mjs'})`], { cwd: join(stage, 'packages/cli') })
      // Ask the target revision, never the installer's constants.
      const runtime = JSON.parse(execFileSync(process.execPath, [join(stage, 'node_modules/tsx/dist/cli.mjs'), '-e', "import {runtimeVersion} from './packages/cli/src/runtime-version.ts'; console.log(JSON.stringify(runtimeVersion(process.cwd())))"], { cwd: stage, encoding: 'utf8' }))
      runtime.sourceSha = sha
      runtime.dirty = false
      writeFileSync(join(stage, 'foundation-install.json'), JSON.stringify({ runtime, installedAt: new Date().toISOString() }, null, 2))
      writeFileSync(join(stage, 'foundation'), `#!/bin/sh
FDN_ROOT=${shellQuote(target)}
export FDN_ROOT
if [ "$1" = session ]; then exec ${shellQuote(process.execPath)} "$FDN_ROOT/packages/cli/bin/session.mjs" "$@"; fi
exec ${shellQuote(process.execPath)} "$FDN_ROOT/node_modules/tsx/dist/cli.mjs" "$FDN_ROOT/packages/cli/src/main.ts" "$@"
`, { mode: 0o755 })
      renameSync(stage, target)
    } catch (err) { rmSync(stage, { recursive: true, force: true }); throw err }
  }
  return activateInstall(target, home, previous, io)
  } finally { rmSync(lock, { recursive: true, force: true }) }
}

export function activateInstall(target: string, home: string, previous: string | undefined, io: CliIO): number {
  const base = join(home, '.local/share/foundation')
  const current = join(base, 'current')
  const sha = JSON.parse(readFileSync(join(target, 'foundation-install.json'), 'utf8')).runtime.sourceSha
  const bin = join(home, '.local/bin/foundation')
  const registry = registryPath(home)
  const rollbackPath = join(base, 'rollback.json')
  const unchanged = readLinkIsOurs(current, target) && readLinkIsOurs(bin, join(current, 'foundation'))
    && readGatewayRegistry(registry)?.shim.command === bin && readGatewayRegistry(registry)?.shim.args.join(' ') === 'mcp'
  if (!unchanged) {
    const snapshot: ActivationSnapshot = { target, registry, paths: activationPaths(home).map(path => capturePath(path)) }
    mkdirSync(base, { recursive: true })
    const temp = `${rollbackPath}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(snapshot), { mode: 0o600 })
    renameSync(temp, rollbackPath)
  }
  mkdirSync(dirname(bin), { recursive: true })
  const backup = `${bin}.before-foundation-install`
  if (pathExists(bin) && !pathExists(backup) && !readLinkIsOurs(bin, join(base, 'current/foundation'))) renameSync(bin, backup)
  const swap = (path: string, to: string) => {
    const temp = `${path}.${process.pid}.tmp`
    rmSync(temp, { force: true }); symlinkSync(to, temp); renameSync(temp, path)
  }
  if (previous && previous !== sha) swap(join(base, 'previous'), join(base, 'versions', previous))
  swap(current, target)
  swap(bin, join(current, 'foundation'))
  const entry = readGatewayRegistry(registry)
  if (entry?.shim.command !== bin || entry.shim.args.join(' ') !== 'mcp') {
    writeGatewayRegistry(registry, { name: 'foundation', protocol: 'mcp', shim: { command: bin, args: ['mcp'] }, env: entry?.env || {}, startedAt: new Date().toISOString(), gatewayRev: 1, stateless: true })
  }
  io.stdout(JSON.stringify({ installed: target, sourceSha: sha, previous: previous || null, rollback: `${shellQuote(join(target, 'foundation'))} install --rollback` }))
  return 0
}
function readLinkIsOurs(path: string, target: string): boolean {
  try { return lstatSync(path).isSymbolicLink() && readlinkSync(path) === target } catch { return false }
}

type SavedPath = { kind: 'absent' } | { kind: 'link'; target: string } | { kind: 'file'; data: string; mode: number }
interface ActivationSnapshot { target: string; registry: string; paths: SavedPath[] }

function registryPath(home: string): string {
  return gatewayRegistryPath({ ...process.env, FOUNDATION_GATEWAY_DIR: process.env.FOUNDATION_GATEWAY_DIR || join(home, '.hive/gateways') })
}

function activationPaths(home: string): string[] {
  const base = join(home, '.local/share/foundation')
  return [join(base, 'current'), join(base, 'previous'), join(home, '.local/bin/foundation'), registryPath(home)]
}

function capturePath(path: string): SavedPath {
  if (!pathExists(path)) return { kind: 'absent' }
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) return { kind: 'link', target: readlinkSync(path) }
  if (!stat.isFile()) throw new Error(`Refusing to replace non-file ${path}`)
  return { kind: 'file', data: readFileSync(path).toString('base64'), mode: stat.mode & 0o777 }
}

function installPlan(target: string, home: string, sha: string, previous: string | undefined) {
  const paths = activationPaths(home)
  const current = paths[0]!
  return { dryRun: true, sourceSha: sha, previous: previous || null, node: { path: process.execPath, version: process.version },
    release: { path: target, action: existsSync(join(target, 'foundation-install.json')) ? 'reuse' : 'archive, install locked dependencies and build session' },
    changes: paths.map((path, i) => ({ path, before: (() => { const state = capturePath(path); return state.kind === 'file' ? { kind: 'file', bytes: Buffer.from(state.data, 'base64').length, mode: state.mode } : state })(),
      after: i === 0 ? { kind: 'link', target } : i === 1 ? previous && previous !== sha ? { kind: 'link', target: join(home, '.local/share/foundation/versions', previous) } : 'unchanged'
        : i === 2 ? { kind: 'link', target: join(current, 'foundation') } : { command: paths[2], args: ['mcp'], env: 'preserved' } })),
    rollbackSnapshot: join(home, '.local/share/foundation/rollback.json'),
    originalExecutableBackup: `${paths[2]}.before-foundation-install`,
    rollback: `${shellQuote(join(target, 'foundation'))} install --rollback`,
    sessionPolicy: 'Drain writers before activation; running processes retain the previous runtime.',
  }
}

function rollbackInstall(home: string, dryRun: boolean, io: CliIO): number {
  const base = join(home, '.local/share/foundation')
  const snapshotPath = join(base, 'rollback.json')
  let snapshot: ActivationSnapshot
  try { snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) } catch { io.stderr('No saved activation to roll back.'); return 1 }
  const paths = activationPaths(home)
  if (!snapshot || typeof snapshot.target !== 'string' || snapshot.registry !== registryPath(home) || !Array.isArray(snapshot.paths) || snapshot.paths.length !== paths.length
    || !snapshot.paths.every(state => state && (state.kind === 'absent' || (state.kind === 'link' && typeof state.target === 'string')
      || (state.kind === 'file' && typeof state.data === 'string' && Number.isInteger(state.mode))))) {
    io.stderr('Invalid rollback snapshot; refusing changes.'); return 1
  }
  if (!readLinkIsOurs(paths[0]!, snapshot.target)) { io.stderr('Current release changed since this activation; refusing rollback.'); return 1 }
  if (dryRun) { io.stdout(JSON.stringify({ dryRun: true, rollback: snapshot.target, restores: paths.map((path, i) => ({ path, kind: snapshot.paths[i]!.kind })) })); return 0 }
  const lock = join(base, 'install.lock')
  try { mkdirSync(lock) } catch { io.stderr(`Another install may be active; inspect ${lock} before retrying.`); return 1 }
  try {
    if (readFileSync(snapshotPath, 'utf8') !== JSON.stringify(snapshot) || !readLinkIsOurs(paths[0]!, snapshot.target)) {
      io.stderr('Activation changed during rollback planning; rerun rollback.'); return 1
    }
    for (const [i, path] of paths.entries()) {
      const state = snapshot.paths[i]!
      if (state.kind === 'absent') { rmSync(path, { force: true }); continue }
      mkdirSync(dirname(path), { recursive: true })
      const temp = `${path}.${process.pid}.tmp`
      rmSync(temp, { force: true })
      if (state.kind === 'link') symlinkSync(state.target, temp)
      else writeFileSync(temp, Buffer.from(state.data, 'base64'), { mode: state.mode })
      renameSync(temp, path)
    }
    renameSync(snapshotPath, join(base, 'rollback-restored.json'))
    io.stdout(JSON.stringify({ rolledBack: snapshot.target, restored: paths }))
    return 0
  } finally { rmSync(lock, { recursive: true, force: true }) }
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

function pathExists(path: string): boolean {
  try { lstatSync(path); return true } catch { return false }
}
