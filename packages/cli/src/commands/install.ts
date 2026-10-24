import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, lstatSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { CliIO } from '../io.js'
import { parseArgs, flagString } from '../argv.js'
import { sourceRoot } from '../runtime-version.js'
import { gatewayRegistryPath, writeGatewayRegistry, readGatewayRegistry } from '../mcp/gatewayRegistry.js'

export async function runInstall(args: string[], io: CliIO): Promise<number> {
  const { flags, positionals } = parseArgs(args)
  if (positionals.length || Object.keys(flags).some((key) => !['from', 'sha', 'force'].includes(key))
      || (flags.from !== undefined && typeof flags.from !== 'string')
      || (flags.sha !== undefined && (typeof flags.sha !== 'string' || !/^[a-f0-9]{7,40}$/i.test(flags.sha)))
      || (flags.force !== undefined && flags.force !== true)) {
    io.stderr('usage: foundation install [--from CHECKOUT] [--sha SHA] [--force]')
    return 2
  }
  const from = resolve(flagString(flags, 'from') || process.env.FDN_ROOT || sourceRoot)
  if (!existsSync(join(from, '.git'))) { io.stderr('Install requires --from pointing to a Git checkout root.'); return 2 }
  const git = (...argv: string[]) => execFileSync('git', ['-C', from, ...argv], { encoding: 'utf8' }).trim()
  const sha = git('rev-parse', '--verify', `${flagString(flags, 'sha') || 'HEAD'}^{commit}`)
  const home = process.env.HOME || homedir()
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
  mkdirSync(dirname(target), { recursive: true })
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
}

/** Activate only after the complete release is ready; preserve the pre-install setup. */
export function activateInstall(target: string, home: string, previous: string | undefined, io: CliIO): number {
  const base = join(home, '.local/share/foundation')
  const current = join(base, 'current')
  const sha = JSON.parse(readFileSync(join(target, 'foundation-install.json'), 'utf8')).runtime.sourceSha
  const bin = join(home, '.local/bin/foundation')
  mkdirSync(dirname(bin), { recursive: true })
  const backup = `${bin}.before-foundation-install`
  // Keep the original executable exactly once, including symlinks.
  if (pathExists(bin) && !pathExists(backup) && !readLinkIsOurs(bin, base)) renameSync(bin, backup)
  const swap = (path: string, to: string) => {
    const temp = `${path}.${process.pid}.tmp`
    rmSync(temp, { force: true }); symlinkSync(to, temp); renameSync(temp, path)
  }
  if (previous && previous !== sha) swap(join(base, 'previous'), join(base, 'versions', previous))
  swap(current, target)
  swap(bin, join(current, 'foundation'))
  const registry = gatewayRegistryPath()
  const entry = readGatewayRegistry(registry)
  // Back up even an already-correct registration so first-install rollback preserves it.
  if (!previous && existsSync(registry) && !existsSync(`${registry}.before-foundation-install`)) {
    writeFileSync(`${registry}.before-foundation-install`, readFileSync(registry), { mode: 0o600 })
    chmodSync(`${registry}.before-foundation-install`, 0o600)
  }
  if (entry?.shim.command !== bin || entry.shim.args.join(' ') !== 'mcp') {
    writeGatewayRegistry(registry, { name: 'foundation', protocol: 'mcp', shim: { command: bin, args: ['mcp'] }, env: entry?.env || {}, startedAt: new Date().toISOString(), gatewayRev: 1, stateless: true })
  }
  const restoreBin = pathExists(backup) ? `rm ${shellQuote(bin)} && mv ${shellQuote(backup)} ${shellQuote(bin)}` : `rm ${shellQuote(bin)}`
  const registryBackup = `${registry}.before-foundation-install`
  const restoreRegistry = existsSync(registryBackup) ? `mv ${shellQuote(registryBackup)} ${shellQuote(registry)}` : `rm ${shellQuote(registry)}`
  let rollbackRelease: string | undefined
  try { rollbackRelease = JSON.parse(readFileSync(join(base, 'previous/foundation-install.json'), 'utf8')).runtime.sourceSha } catch {}
  io.stdout(JSON.stringify({ installed: target, sourceSha: sha, previous: previous || null, rollback: rollbackRelease ? `ln -sfn ${shellQuote(join(base, 'versions', rollbackRelease))} ${shellQuote(current)}` : `${restoreBin}; ${restoreRegistry}` }))
  return 0
}
import { readlinkSync } from 'node:fs'
function readLinkIsOurs(path: string, base: string): boolean {
  return lstatSync(path).isSymbolicLink() && readlinkSync(path) === join(base, 'current/foundation')
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

function pathExists(path: string): boolean {
  try { lstatSync(path); return true } catch { return false }
}
