import { readDirectStatus } from '../sync/direct.js'
import { materialize, MaterializeError } from '../sync/materialize.js'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { findShareRoot, readShareConfig } from '../share/config.js'
import { replicaRoot } from '../sync-store.js'
import { loadChain } from 'foundation-engine'
import { parseArgs, flagString } from '../argv.js'
import type { CliIO } from '../io.js'
import { registerDesign, closeDesign, liveDesigns, readSyncState } from '../sync-store.js'
import { serveSync, copyKey, feedName, type CombConfig } from '../sync/daemon.js'

export async function runSync(args: string[], io: CliIO): Promise<number> {
  const { positionals, flags } = parseArgs(args)
  try {
    switch (positionals[0]) {
      case 'materialize':
      case 'materialise': {
        const entryFile = flagString(flags, 'entry')
        const entry = entryFile ? JSON.parse(readFileSync(entryFile, 'utf8')) : {}
        if (entry.deleted === true) throw new MaterializeError('deleted-source', 'the selected replica was deleted')
        const docId = positionals[1] ?? entry.docId
        const root = flagString(flags, 'repo-root')
        const configFile = flagString(flags, 'comb-config') ?? process.env.FOUNDATION_COMB_CONFIG
        if (!docId || !root || !configFile) throw new Error('materialize requires DOC_ID (or --entry FILE), --repo-root ROOT and --comb-config FILE')
        const config = JSON.parse(readFileSync(configFile, 'utf8')) as CombConfig
        if (!config || typeof config.binary !== 'string' || !Array.isArray(config.args) || config.args.some(arg => typeof arg !== 'string')) throw new Error('invalid Comb process config')
        const result = await materialize({
          docId, workspaceId: flagString(flags, 'workspace') ?? entry.workspaceId ?? process.env.FOUNDATION_WORKSPACE ?? 'default',
          productId: flagString(flags, 'product') ?? entry.productId ?? process.env.FOUNDATION_PRODUCT ?? 'default',
          checkoutRoot: root, targetPath: positionals[2],
          repoRelativePath: flagString(flags, 'repo-relative-path') ?? entry.repoRelativePath,
          sourceReplica: flagString(flags, 'source-replica') ?? entry.replicaId,
          expectedHead: flagString(flags, 'expected-head') ?? entry.expectedHead ?? entry.headHash,
          requestKey: flagString(flags, 'request-key') ?? entry.requestKey,
        }, config)
        io.stdout(flags.json ? JSON.stringify(result) : `ready: ${result.path}`); return 0
      }
      case 'open': {
        if (!positionals[1]) throw new Error('sync open requires a file')
        const design = registerDesign(positionals[1], flagString(flags, 'workspace'), flagString(flags, 'product'), flagString(flags, 'repo-root'), message => io.stderr(message))
        io.stdout(`saved locally: ${feedName(design)}`); return 0
      }
      case 'close': {
        if (!positionals[1]) throw new Error('sync close requires a file')
        closeDesign(positionals[1]); io.stdout('closed for sync; with automatic registration enabled, the next open or edit registers it again'); return 0
      }
      case 'status': {
        const direct = readDirectStatus()
        const rows = liveDesigns().map(design => {
          const root=design.repoRoot??findShareRoot(dirname(design.file));const share=root?readShareConfig(root):null
          let sharing:unknown={state:'git-only'}
          if(share){try{sharing=JSON.parse(readFileSync(join(replicaRoot(),'sharing',`${share.space}.json`),'utf8'))}catch{sharing={state:'sign in'}}}
          let state
          try { state = readSyncState(copyKey(design)) } catch (err) {
            return { ...design, direct, sharing, feed: feedName(design), status: 'saved locally', pending: null, cursor: null, lastError: `replica state: ${String(err)}`, lastErrorAt: null, catalogueError: null, updatedAt: '' }
          }
          let pending: number | null = null, localError: string | null = null
          try { const known = new Set(state.published); pending = loadChain(readFileSync(`${design.file}.chain`)).changes().filter(c => !known.has(c.envelope.hash)).length } catch (err) { localError = String(err) }
          return { ...design, direct, sharing, feed: feedName(design), status: (localError ?? state.lastError) && pending === 0 ? 'blocked' : pending === 0 ? 'shared' : state.updatedAt ? 'waiting to upload' : 'saved locally', pending, cursor: state.cursor, lastError: localError ?? state.lastError, lastErrorAt: state.lastErrorAt ?? null, catalogueError: state.catalogueError ?? null, updatedAt: state.updatedAt }
        })
        io.stdout(flags.json ? JSON.stringify(rows) : rows.map(row => `${row.file}: ${row.status} [direct ${row.direct.state}${row.direct.reason ? `: ${row.direct.reason}` : ''}] (${row.pending ?? '?'} waiting)${row.lastError ? ` — ${row.lastError}` : ''}${row.catalogueError ? ` — catalogue: ${row.catalogueError}` : ''}`).join('\n'))
        return 0
      }
      case 'serve': {
        const file = flagString(flags, 'comb-config') ?? process.env.FOUNDATION_COMB_CONFIG
        const raw: unknown = file ? JSON.parse(readFileSync(file, 'utf8')) : {binary:'',args:[]}
        const config = raw as CombConfig
        if (!config || typeof config.binary !== 'string' || !Array.isArray(config.args) || config.args.some(arg => typeof arg !== 'string')) throw new Error('Comb config requires {binary: string, args: string[]}')
        if (config.node && (typeof config.node.id !== 'string' || !config.node.id || typeof config.node.name !== 'string' || !config.node.name)) throw new Error('Comb config node requires id and name')
        const controller = new AbortController(), stop = (): void => controller.abort()
        process.once('SIGTERM', stop); process.once('SIGINT', stop)
        try { await serveSync(config, controller.signal, io.stderr) } finally { process.off('SIGTERM', stop); process.off('SIGINT', stop) }
        return 0
      }
      default: throw new Error('usage: foundation sync materialize DOC_ID [TARGET] --repo-root ROOT --comb-config FILE [--workspace W --product P --json] | open <file> [--workspace W --product P --repo-root R] | close <file> | serve --comb-config <file> | status [--json]')
    }
  } catch (err) {
    if (flags.json && err instanceof MaterializeError) io.stdout(JSON.stringify({ state: 'refused', code: err.code, message: err.message, ...(err.path ? { path: err.path } : {}) }))
    else io.stderr(err instanceof Error ? err.message : String(err))
    return 1
  }
}
