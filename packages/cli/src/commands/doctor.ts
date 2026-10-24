import { defaultChainFormat } from '../chain-format.js'
/** Read-only runtime inventory. Discovered commands are data, never executed. */
import { accessSync, constants, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import type { CliIO } from '../io.js'
import { parseArgs } from '../argv.js'
import { inspect, readable, type InventoryEntry } from '../runtime-inventory.js'
import { runCapabilities } from './capabilities.js'

function configCommands(value: unknown, foundation = false): string[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap((item) => configCommands(item, foundation))
  const record = value as Record<string, unknown>
  const named = foundation || record.name === 'foundation'
  const found = named && typeof record.command === 'string' ? [record.command] : []
  if (named && Array.isArray(record.args)) {
    for (const arg of record.args) {
      if (typeof arg === 'string' && isAbsolute(arg)) found.push(arg)
    }
  }
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
  if ('capabilities' in flags) return runCapabilities(args, io)
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
  // Read configuration files only, including the repository root one level
  // below each Cell. Never descend into source trees or follow directory links.
  const names = ['.mcp.json', 'mcp.json', 'gateways.json', '.hive-gateways.json', '.claude.json', '.claude/settings.json', '.claude/settings.local.json', '.codex/config.toml']
  const addConfigs = (root: string) => { for (const name of names) configs.add(join(root, name)) }
  const directories = (root: string): string[] => {
    try { return readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => join(root, item.name)) } catch { return [] }
  }
  const cells = join(home, '.hive', 'v2', 'cells')
  let cellCoverage = 'known MCP/gateway configs at Cell roots and immediate repository roots; source files excluded'
  try {
    accessSync(cells, constants.R_OK)
    for (const cell of directories(cells)) {
      addConfigs(cell)
      for (const repo of directories(cell)) addConfigs(repo)
    }
  } catch { cellCoverage = 'Cell directory missing or unreadable; Cell config coverage unavailable' }
  addConfigs(home)
  const accountHomes = join(home, '.hive', 'homes')
  for (const account of directories(accountHomes)) addConfigs(account)
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
      if (target) entries.push(inspect(target, path === registry ? 'gateway-registry' : `config:${path}`))
      else configInventory.push({ path, status: 'relative command cannot be resolved without config cwd' })
    }
  }
  io.stdout(JSON.stringify({ inventoryVersion: 1, readOnly: true, chainFormats: [1, 2], defaultChainFormat: defaultChainFormat(), coverage: { cells: cellCoverage, harnessHomes: 'known MCP configs in HOME and immediate ~/.hive/homes account directories', commandsExecuted: false, metadata: 'install stamp claims only; unstamped runtime metadata is unknown' }, entries, configs: configInventory }, null, 2))
  return 0
}
