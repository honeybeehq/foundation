import { mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { loadChain } from 'foundation-engine'
import { writeAtomic } from './disk.js'

export interface LiveDesign { docId: string; file: string; workspace: string; product: string; repoRoot?: string }
export interface SyncState { cursor: string; published: string[]; lastError: string | null; lastErrorAt?: string; catalogueError?: string | null; updatedAt: string; pending: number }
export function replicaRoot(): string { return process.env.FOUNDATION_REPLICA_STORE ?? join(homedir(), '.foundation', 'replicas') }
export function registerDesign(file: string, workspace = process.env.FOUNDATION_WORKSPACE ?? 'default', product = process.env.FOUNDATION_PRODUCT ?? 'default', repoRoot?: string): LiveDesign {
  file = realpathSync(file)
  const docId = loadChain(readFileSync(`${file}.chain`)).docId()
  if (!docId) throw new Error('sync requires a tracked design with a document id')
  for (const part of [workspace, product, docId]) if (!/^[A-Za-z0-9._-]+$/.test(part)) throw new Error('invalid sync address component')
  const design = { docId, file, workspace, product, ...(repoRoot ? { repoRoot: realpathSync(repoRoot) } : {}) }
  const dir = join(replicaRoot(), 'live'); mkdirSync(dir, { recursive: true })
  // Each registration owns a path record; opening another copy never overwrites it.
  const key = createHash('sha256').update(JSON.stringify({ docId, file, workspace, product })).digest('hex')
  writeAtomic(join(dir, `${key}.json`), JSON.stringify(design))
  return design
}
export function liveDesigns(log: (message: string) => void = () => {}): LiveDesign[] {
  const dir = join(replicaRoot(), 'live')
  try { return readdirSync(dir).filter(f => f.endsWith('.json')).flatMap(f => {
    try {
      const value = JSON.parse(readFileSync(join(dir, f), 'utf8')) as LiveDesign
      if (!value || typeof value.file !== 'string' || ![value.workspace, value.product, value.docId].every(part => typeof part === 'string' && /^[A-Za-z0-9._-]+$/.test(part))) throw new Error('invalid live design')
      return [value]
    } catch (err) { log(`sync registry ${f}: ${String(err)}`); return [] }
  }) }
  catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; throw err }
}
export function statePath(key: string): string { return join(replicaRoot(), `${key}.json`) }
export function readSyncState(key: string): SyncState {
  try {
    const state = JSON.parse(readFileSync(statePath(key), 'utf8')) as SyncState
    if (!state || typeof state.cursor !== 'string' || !/^[1-9][0-9]*$/.test(state.cursor) || !Array.isArray(state.published) || state.published.some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) || !(state.lastError === null || typeof state.lastError === 'string') || typeof state.updatedAt !== 'string' || !Number.isSafeInteger(state.pending) || state.pending < 0) throw new Error('invalid replica checkpoint; stop sync and restore or remove it to replay')
    return state
  }
  catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; return { cursor: '1', published: [], lastError: null, updatedAt: '', pending: 0 } }
}
export function writeSyncState(key: string, state: SyncState): void { mkdirSync(replicaRoot(), { recursive: true }); writeAtomic(statePath(key), JSON.stringify(state)) }

export function closeDesign(file: string): void {
  file = realpathSync(file)
  const dir = join(replicaRoot(), 'live')
  try {
    for (const entry of readdirSync(dir).filter(f => f.endsWith('.json'))) {
      let value: LiveDesign
      try { value = JSON.parse(readFileSync(join(dir, entry), 'utf8')) as LiveDesign } catch { continue }
      if (value?.file === file) unlinkSync(join(dir, entry))
    }
  } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err }
}
/** Opt-in node installation hook; sync registration must never prevent local editing. */
export function autoOpenDesign(file: string, log: (message: string) => void): void {
  if (process.env.FOUNDATION_SYNC_AUTO_OPEN !== '1') return
  try {
    const canonical = realpathSync(file)
    if (liveDesigns().some(design => design.file === canonical)) return
    registerDesign(canonical)
  } catch (err) { log(`sync registration: ${String(err)}`) }
}
