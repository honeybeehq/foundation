import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, lstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { CliIO } from '../io.js'
import { parseArgs, flagString } from '../argv.js'
import { runtimeVersion, sourceRoot } from '../runtime-version.js'
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
      execFileSync('pnpm', ['install', '--frozen-lockfile'], { cwd: stage, stdio: ['ignore', 'pipe', 'pipe'] })
      execFileSync(process.execPath, ['--input-type=module', '-e', `import {build} from 'esbuild'; await build({entryPoints:['src/session/bin.ts'],bundle:true,platform:'node',format:'esm',target:'node22',external:['loro-crdt'],outfile:'dist/session.mjs'})`], { cwd: join(stage, 'packages/cli') })
      const runtime = { ...runtimeVersion(stage), sourceSha: sha, dirty: false }
      writeFileSync(join(stage, 'foundation-install.json'), JSON.stringify({ runtime, installedAt: new Date().toISOString() }, null, 2))
      writeFileSync(join(stage, 'foundation'), `#!/bin/sh
FDN_ROOT=${shellQuote(target)}
export FDN_ROOT
if [ "$1" = session ]; then exec node "$FDN_ROOT/packages/cli/bin/session.mjs" "$@"; fi
exec "$FDN_ROOT/node_modules/.bin/tsx" "$FDN_ROOT/packages/cli/src/main.ts" "$@"
`, { mode: 0o755 })
      renameSync(stage, target)
    } catch (err) { rmSync(stage, { recursive: true, force: true }); throw err }
  }
  const bin = join(home, '.local/bin/foundation')
  mkdirSync(dirname(bin), { recursive: true })
  const backup = `${bin}.before-foundation-install`
  // Keep the original executable exactly once, including symlinks.
  if (existsSync(bin) && !existsSync(backup) && !readLinkIsOurs(bin, base)) renameSync(bin, backup)
  const swap = (path: string, to: string) => {
    const temp = `${path}.${process.pid}.tmp`
    rmSync(temp, { force: true }); symlinkSync(to, temp); renameSync(temp, path)
  }
  swap(current, target)
  swap(bin, join(current, 'foundation'))
  const registry = gatewayRegistryPath()
  const entry = readGatewayRegistry(registry)
  if (entry?.shim.command !== bin) {
    if (existsSync(registry) && !existsSync(`${registry}.before-foundation-install`)) writeFileSync(`${registry}.before-foundation-install`, readFileSync(registry))
    writeGatewayRegistry(registry, { name: 'foundation', protocol: 'mcp', shim: { command: bin, args: ['mcp'] }, env: {}, startedAt: new Date().toISOString(), gatewayRev: 1, stateless: true })
  }
  const restoreBin = existsSync(backup) ? `rm ${shellQuote(bin)} && mv ${shellQuote(backup)} ${shellQuote(bin)}` : `rm ${shellQuote(bin)}`
  const registryBackup = `${registry}.before-foundation-install`
  const restoreRegistry = existsSync(registryBackup) ? `mv ${shellQuote(registryBackup)} ${shellQuote(registry)}` : `rm ${shellQuote(registry)}`
  io.stdout(JSON.stringify({ installed: target, sourceSha: sha, previous: previous || null, rollback: previous ? `ln -sfn ${shellQuote(join(base, 'versions', previous))} ${shellQuote(current)}` : `${restoreBin}; ${restoreRegistry}` }))
  return 0
}
import { readlinkSync } from 'node:fs'
function readLinkIsOurs(path: string, base: string): boolean {
  return lstatSync(path).isSymbolicLink() && readlinkSync(path) === join(base, 'current/foundation')
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}
