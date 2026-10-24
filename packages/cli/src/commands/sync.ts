import { readFileSync } from 'node:fs'
import { loadChain } from 'foundation-engine'
import { parseArgs, flagString } from '../argv.js'
import type { CliIO } from '../io.js'
import { registerDesign, closeDesign, liveDesigns, readSyncState } from '../sync-store.js'
import { serveSync, copyKey, feedName, type CombConfig } from '../sync/daemon.js'

export async function runSync(args: string[], io: CliIO): Promise<number> {
  const { positionals, flags } = parseArgs(args)
  try {
    switch (positionals[0]) {
      case 'open': {
        if (!positionals[1]) throw new Error('sync open requires a file')
        const design = registerDesign(positionals[1], flagString(flags, 'workspace'), flagString(flags, 'product'), flagString(flags, 'repo-root'))
        io.stdout(`saved locally: ${feedName(design)}`); return 0
      }
      case 'close': {
        if (!positionals[1]) throw new Error('sync close requires a file')
        closeDesign(positionals[1]); io.stdout('closed for sync; with automatic registration enabled, the next open or edit registers it again'); return 0
      }
      case 'status': {
        const rows = liveDesigns().map(design => {
          let state
          try { state = readSyncState(copyKey(design)) } catch (err) {
            return { ...design, feed: feedName(design), status: 'saved locally', pending: null, cursor: null, lastError: `replica state: ${String(err)}`, lastErrorAt: null, catalogueError: null, updatedAt: '' }
          }
          let pending: number | null = null, localError: string | null = null
          try { const known = new Set(state.published); pending = loadChain(readFileSync(`${design.file}.chain`)).changes().filter(c => !known.has(c.envelope.hash)).length } catch (err) { localError = String(err) }
          return { ...design, feed: feedName(design), status: (localError ?? state.lastError) && pending === 0 ? 'blocked' : pending === 0 ? 'shared' : state.updatedAt ? 'waiting to upload' : 'saved locally', pending, cursor: state.cursor, lastError: localError ?? state.lastError, lastErrorAt: state.lastErrorAt ?? null, catalogueError: state.catalogueError ?? null, updatedAt: state.updatedAt }
        })
        io.stdout(flags.json ? JSON.stringify(rows) : rows.map(row => `${row.file}: ${row.status} (${row.pending ?? '?'} waiting)${row.lastError ? ` — ${row.lastError}` : ''}${row.catalogueError ? ` — catalogue: ${row.catalogueError}` : ''}`).join('\n'))
        return 0
      }
      case 'serve': {
        const file = flagString(flags, 'comb-config') ?? process.env.FOUNDATION_COMB_CONFIG
        if (!file) throw new Error('sync serve requires --comb-config <file> (or FOUNDATION_COMB_CONFIG)')
        const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
        const config = raw as CombConfig
        if (!config || typeof config.binary !== 'string' || !Array.isArray(config.args) || config.args.some(arg => typeof arg !== 'string')) throw new Error('Comb config requires {binary: string, args: string[]}')
        if (config.node && (typeof config.node.id !== 'string' || !config.node.id || typeof config.node.name !== 'string' || !config.node.name)) throw new Error('Comb config node requires id and name')
        const controller = new AbortController(), stop = (): void => controller.abort()
        process.once('SIGTERM', stop); process.once('SIGINT', stop)
        try { await serveSync(config, controller.signal, io.stderr) } finally { process.off('SIGTERM', stop); process.off('SIGINT', stop) }
        return 0
      }
      default: throw new Error('usage: foundation sync open <file> [--workspace W --product P --repo-root R] | close <file> | serve --comb-config <file> | status [--json]')
    }
  } catch (err) { io.stderr(err instanceof Error ? err.message : String(err)); return 1 }
}
