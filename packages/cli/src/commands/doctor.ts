/** Read-only runtime inventory. Discovered commands are data, never executed. */
import { accessSync, constants, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import type { CliIO } from '../io.js'
import { parseArgs } from '../argv.js'

interface InventoryEntry {
  source: string
  path: string
  realpath: string | null
  executable: boolean
  sourceSha: string | null
  stampPath: string | null
  packageVersion: string | null
  dirty: boolean | null
  sessionProtocols: string[] | null
  documentFormats: string[] | null
  artboardWriteSafe: boolean | 'unknown'
  error?: string
}

function readable(path: string): string | null {
  try {
    // Bound reads, and do not block on devices or FIFOs supplied through PATH.
    const stat = statSync(path)
    if (!stat.isFile() || stat.size > 1024 * 1024) return null
    return readFileSync(path, 'utf8')
  } catch { return null }
}

function inspect(path: string, source: string): InventoryEntry {
  const entry: InventoryEntry = { source, path, realpath: null, executable: false, sourceSha: null, stampPath: null, packageVersion: null, dirty: null, sessionProtocols: null, documentFormats: null, artboardWriteSafe: 'unknown' }
  try { entry.realpath = realpathSync(path) } catch { entry.error = 'missing or inaccessible'; return entry }
  try { accessSync(path, constants.X_OK); entry.executable = statSync(path).isFile() } catch { /* not executable */ }
  // Only an explicit stamp is evidence of a build SHA; a nearby checkout HEAD
  // would not establish which source produced an installed executable.
  let root = dirname(entry.realpath)
  for (let depth = 0; depth < 6; depth++) {
    const raw = readable(join(root, 'foundation-install.json'))
    if (raw) {
      try {
        const value: unknown = JSON.parse(raw)
        if (value && typeof value === 'object' && 'runtime' in value
            && value.runtime && typeof value.runtime === 'object') {
          entry.stampPath = join(root, 'foundation-install.json')
          const runtime = value.runtime
          if ('packageVersion' in runtime && typeof runtime.packageVersion === 'string') entry.packageVersion = runtime.packageVersion
          if ('dirty' in runtime && typeof runtime.dirty === 'boolean') entry.dirty = runtime.dirty
          if ('sessionProtocols' in runtime && Array.isArray(runtime.sessionProtocols) && runtime.sessionProtocols.every((v: unknown) => typeof v === 'string')) entry.sessionProtocols = runtime.sessionProtocols
          if ('documentFormats' in runtime && Array.isArray(runtime.documentFormats) && runtime.documentFormats.every((v: unknown) => typeof v === 'string')) entry.documentFormats = runtime.documentFormats
          if ('sourceSha' in runtime && typeof runtime.sourceSha === 'string'
              && /^[a-f0-9]{40,64}$/i.test(runtime.sourceSha)) entry.sourceSha = runtime.sourceSha
          if ('artboardWriteSafe' in runtime && typeof runtime.artboardWriteSafe === 'boolean') {
            entry.artboardWriteSafe = runtime.artboardWriteSafe
          }
        }
      } catch { /* unknown stamp format */ }
      break
    }
    const parent = dirname(root)
    if (parent === root) break
    root = parent
  }
  return entry
}

function configCommands(value: unknown, foundation = false): string[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap((item) => configCommands(item, foundation))
  const record = value as Record<string, unknown>
  const named = foundation || record.name === 'foundation'
  const found = named && typeof record.command === 'string' ? [record.command] : []
  for (const [key, child] of Object.entries(record)) {
    if (child && typeof child === 'object') found.push(...configCommands(child, named || key === 'foundation'))
  }
  return found
}

/** Conservative TOML subset: only literal command strings in Foundation's MCP
 * table. Interpolation and shell expressions remain unresolved inventory data. */
function tomlCommands(raw: string): string[] {
  let foundation = false
  const commands: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    const table = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(line)
    if (table) {
      foundation = /^mcp_servers\.(?:foundation|"foundation"|'foundation')$/.test(table[1] ?? '')
      continue
    }
    if (!foundation) continue
    const match = /^\s*command\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/.exec(line)
    if (!match?.[1]) continue
    try { commands.push(match[1].startsWith('"') ? JSON.parse(match[1]) : match[1].slice(1, -1)) } catch { /* unsupported escape */ }
  }
  return commands
}

export async function runDoctor(args: string[], io: CliIO): Promise<number> {
  const { flags, positionals } = parseArgs(args)
  if (flags.inventory !== true || flags.json !== true || positionals.length
      || Object.keys(flags).some((key) => key !== 'inventory' && key !== 'json')) {
    io.stderr('usage: foundation doctor --inventory --json')
    return 2
  }
  const home = process.env.HOME || homedir()
  const pathDirs = (process.env.PATH || '').split(delimiter).filter(Boolean)
  const entries: InventoryEntry[] = []
  for (const dir of [...new Set(pathDirs)]) {
    const path = resolve(dir, 'foundation')
    try { statSync(path); entries.push(inspect(path, 'PATH')) } catch { /* absent PATH candidate */ }
  }
  entries.push(inspect(join(home, '.local', 'bin', 'foundation'), 'local-bin'))
  const registry = join(process.env.FOUNDATION_GATEWAY_DIR || join(home, '.hive', 'gateways'), 'foundation.json')
  const configs = new Set([registry])
  // Only known config locations are inspected: never recurse into Cell checkouts.
  const cells = join(home, '.hive', 'v2', 'cells')
  let cellCoverage = 'known config paths at immediate Cell roots only; checkout contents excluded'
  try {
    for (const cell of readdirSync(cells, { withFileTypes: true })) {
      if (!cell.isDirectory()) continue
      for (const name of ['.mcp.json', 'mcp.json', 'gateways.json', '.claude/settings.json', '.codex/config.toml']) {
        configs.add(join(cells, cell.name, name))
      }
    }
  } catch { cellCoverage = 'Cell directory missing or unreadable; Cell config coverage unavailable' }
  const configInventory: { path: string; status: string }[] = []
  for (const path of configs) {
    const raw = readable(path)
    if (raw === null) {
      if (path === registry) configInventory.push({ path, status: 'missing or unreadable' })
      continue
    }
    let commands: string[]
    try { commands = path.endsWith('.toml') ? tomlCommands(raw) : configCommands(JSON.parse(raw)) } catch {
      configInventory.push({ path, status: 'unsupported or malformed config' })
      continue
    }
    configInventory.push({ path, status: 'read' })
    for (const command of commands) {
      const candidates = isAbsolute(command) ? [command]
        : command.includes('/') ? [] : pathDirs.map((dir) => resolve(dir, command))
      let target = candidates[0]
      for (const candidate of candidates) {
        try { accessSync(candidate, constants.X_OK); target = candidate; break } catch { /* next PATH entry */ }
      }
      if (target) entries.push(inspect(target, path === registry ? 'gateway-registry' : `cell-config:${path}`))
      else configInventory.push({ path, status: 'relative command cannot be resolved without config cwd' })
    }
  }
  io.stdout(JSON.stringify({ inventoryVersion: 1, readOnly: true, coverage: { cells: cellCoverage, commandsExecuted: false, metadata: 'install stamp claims only; unstamped runtime metadata is unknown' }, entries, configs: configInventory }, null, 2))
  return 0
}
