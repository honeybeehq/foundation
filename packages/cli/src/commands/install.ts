import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
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
  let snapshot: ActivationSnapshot | undefined
  if (!unchanged) {
    snapshot = { target, registry, paths: activationPaths(home).map(path => capturePath(path)) }
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
  if (snapshot) {
    snapshot.shell = writeRollbackShell(home, snapshot)
    const temp = `${rollbackPath}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(snapshot), { mode: 0o600 })
    renameSync(temp, rollbackPath)
  } else {
    try { snapshot = JSON.parse(readFileSync(rollbackPath, 'utf8')) } catch {}
  }
  io.stdout(JSON.stringify({ installed: target, sourceSha: sha, previous: previous || null,
    rollback: snapshot?.shell ? `/bin/sh ${shellQuote(snapshot.shell)}` : null,
    rollbackCommand: `${shellQuote(join(target, 'foundation'))} install --rollback` }))
  return 0
}
function readLinkIsOurs(path: string, target: string): boolean {
  try { return lstatSync(path).isSymbolicLink() && readlinkSync(path) === target } catch { return false }
}

type SavedPath = { kind: 'absent' } | { kind: 'link'; target: string } | { kind: 'file'; data: string; mode: number }
interface ActivationSnapshot { target: string; registry: string; paths: SavedPath[]; shell?: string }

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
    originalExecutableBackup: { path: `${paths[2]}.before-foundation-install`, action: pathExists(paths[2]!) && !pathExists(`${paths[2]}.before-foundation-install`) && !readLinkIsOurs(paths[2]!, join(current, 'foundation')) ? 'rename existing executable here' : 'unchanged' },
    rollback: 'A runtime-independent /bin/sh command is printed after activation; --rollback restores the same snapshot.',
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
  if (dryRun) { io.stdout(JSON.stringify({ dryRun: true, rollback: snapshot.target, restores: paths.map((path, i) => ({ path, kind: snapshot.paths[i]!.kind })) })); return 0 }
  if (snapshot.shell) {
    try { io.stdout(execFileSync('/bin/sh', [snapshot.shell], { encoding: 'utf8' }).trim()); return 0 }
    catch (error) { io.stderr(`Rollback failed; its snapshot is retained for retry: ${String(error)}`); return 1 }
  }
  const originalCurrent = snapshot.paths[0]!
  if (!readLinkIsOurs(paths[0]!, snapshot.target) && JSON.stringify(capturePath(paths[0]!)) !== JSON.stringify(originalCurrent)) {
    io.stderr('Current release changed since this activation; refusing rollback.'); return 1
  }
  const lock = join(base, 'install.lock')
  try { mkdirSync(lock) } catch { io.stderr(`Another install may be active; inspect ${lock} before retrying.`); return 1 }
  try {
    if (readFileSync(snapshotPath, 'utf8') !== JSON.stringify(snapshot)) {
      io.stderr('Activation changed during rollback planning; rerun rollback.'); return 1
    }
    for (const i of [1, 2, 3, 0]) {
      const path = paths[i]!
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

function writeRollbackShell(home: string, snapshot: ActivationSnapshot): string {
  const base = join(home, '.local/share/foundation')
  const token = randomUUID()
  const backupRoot = join(base, 'rollbacks', token)
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 })
  const paths = activationPaths(home)
  const expected = paths.map(path => capturePath(path))
  const prepare = (states: SavedPath[], prefix: string) => states.forEach((state, i) => {
    if (state.kind === 'file') writeFileSync(join(backupRoot, `${prefix}${i}`), Buffer.from(state.data, 'base64'), { mode: 0o600 })
  })
  prepare(snapshot.paths, 'before'); prepare(expected, 'after')
  const matches = (path: string, state: SavedPath, file: string) => state.kind === 'absent'
    ? `[ ! -e ${shellQuote(path)} ] && [ ! -L ${shellQuote(path)} ]`
    : state.kind === 'link' ? `[ -L ${shellQuote(path)} ] && [ "$(readlink ${shellQuote(path)})" = ${shellQuote(state.target)} ]`
      : `[ -f ${shellQuote(path)} ] && [ ! -L ${shellQuote(path)} ] && cmp -s ${shellQuote(path)} ${shellQuote(file)}`
  const checks = paths.map((path, i) => `if ! { ${matches(path, expected[i]!, join(backupRoot, `after${i}`))}; } && ! { ${matches(path, snapshot.paths[i]!, join(backupRoot, `before${i}`))}; }; then echo ${shellQuote(`Refusing rollback: ${path} changed after activation`)} >&2; exit 1; fi`)
  const restores = [1, 2, 3, 0].map(i => {
    const path = paths[i]!, state = snapshot.paths[i]!
    if (state.kind === 'absent') return `rm -f ${shellQuote(path)}`
    const make = state.kind === 'link' ? `ln -s ${shellQuote(state.target)} "$temp"`
      : `cp ${shellQuote(join(backupRoot, `before${i}`))} "$temp"\nchmod ${state.mode.toString(8)} "$temp"`
    return `temp=${shellQuote(path)}."$$".rollback-tmp\nrm -f "$temp"\n${make}\nif [ "$(uname -s)" = Darwin ]; then mv -fh "$temp" ${shellQuote(path)}; else mv -fT "$temp" ${shellQuote(path)}; fi`
  })
  const marker = join(base, 'rollback-active')
  const script = join(backupRoot, 'restore.sh')
  writeFileSync(script, `#!/bin/sh\nset -eu\nlock=${shellQuote(join(base, 'install.lock'))}\nif ! mkdir "$lock"; then echo 'Install or rollback lock unavailable; inspect it before retrying.' >&2; exit 1; fi\ntrap 'rmdir "$lock"' 0\nif [ "$(cat ${shellQuote(marker)} 2>/dev/null)" != ${shellQuote(token)} ]; then echo 'This rollback is no longer active.' >&2; exit 1; fi\n${checks.join('\n')}\n${restores.join('\n')}\nmv -f ${shellQuote(join(base, 'rollback.json'))} ${shellQuote(join(base, 'rollback-restored.json'))}\nrm -f ${shellQuote(marker)}\necho ${shellQuote(JSON.stringify({ rolledBack: snapshot.target, restored: paths }))}\n`, { mode: 0o700 })
  writeFileSync(marker, token, { mode: 0o600 })
  return script
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

function pathExists(path: string): boolean {
  try { lstatSync(path); return true } catch { return false }
}
