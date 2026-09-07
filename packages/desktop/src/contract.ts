import type { ChangeMeta, FdnAnnotation, FdnDocument, FdnNode, PatchOp } from '../../engine/src/types.js'

export type SyncState = { kind: 'offline' | 'idle' | 'syncing' | 'caught_up' } | { kind: 'paused'; reason: string; resumeAt?: string }
export interface HostState {
  document: FdnDocument | null
  status: {
    replicaId: string; docId: string; log: string; cursor: string; scanCursor: string
    locallySaved: number; pending: number; published: number; staged: number; stagedBytes: number
    causalGap: boolean; sync: SyncState
  }
  connection: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: { code: string; message: string }
}
export interface Receipt { hash: string; status: 'locally_saved'; annotationId?: string }
export interface MutationResult { state: HostState; receipt: Receipt }
export interface DesktopAPI {
  open(): Promise<HostState>
  state(): Promise<HostState>
  commit(ops: PatchOp[], message: string): Promise<MutationResult>
  annotate(input: Omit<FdnAnnotation, 'id' | 'status'>): Promise<MutationResult>
  connection(action: 'connect' | 'disconnect' | 'sync'): Promise<HostState>
  export(): Promise<{ canceled: boolean; files?: { html: string; chain: string } }>
}
export interface HostConfiguration { url: string; token: string; directory: string; docId: string; author: string; seed?: FdnDocument }
export type CommitBody = { meta: ChangeMeta; ops: PatchOp[] }

export function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function strings(value: unknown): value is Record<string, string> { return record(value) && Object.values(value).every(v => typeof v === 'string') }
function node(value: unknown): value is FdnNode {
  return record(value) && typeof value.id === 'string' && typeof value.tag === 'string' && strings(value.attrs) && strings(value.style) && record(value.styleStates)
    && Object.values(value.styleStates).every(strings) && (value.text === undefined || typeof value.text === 'string') && Array.isArray(value.children) && value.children.every(node)
}
export function isDocument(value: unknown): value is FdnDocument {
  return record(value) && typeof value.specVersion === 'string' && strings(value.tokens)
    && ['params', 'data', 'lookups', 'states', 'viewports', 'matrix', 'namedStyles', 'components'].every(k => Array.isArray(value[k]))
    && Array.isArray(value.body) && value.body.every(node)
    && Array.isArray(value.annotations) && value.annotations.every(a => record(a) && typeof a.id === 'string' && typeof a.text === 'string' && ['open', 'resolved', 'wontfix'].includes(String(a.status)) && (a.nodeId === undefined || typeof a.nodeId === 'string'))
}
export function parseState(value: unknown): HostState {
  if (!record(value) || (value.document !== null && !isDocument(value.document)) || !record(value.status)) throw new Error('Host returned an invalid document state')
  const status = value.status
  if (!['replicaId', 'docId', 'log', 'cursor', 'scanCursor'].every(k => typeof status[k] === 'string')
    || !['locallySaved', 'pending', 'published', 'staged', 'stagedBytes'].every(k => typeof status[k] === 'number' && Number.isSafeInteger(status[k]) && status[k] >= 0)
    || typeof status.causalGap !== 'boolean' || !record(status.sync)
    || !['offline', 'idle', 'syncing', 'caught_up', 'paused'].includes(String(status.sync.kind))
    || (status.sync.kind === 'paused' && typeof status.sync.reason !== 'string')
    || !['disconnected', 'connecting', 'connected', 'error'].includes(String(value.connection))
    || (value.error !== undefined && (!record(value.error) || typeof value.error.code !== 'string' || typeof value.error.message !== 'string'))) throw new Error('Host returned an invalid replica status')
  // Runtime checks above establish the wire shape; preserve opaque cursor strings.
  return value as unknown as HostState
}
export function parseMutation(value: unknown): MutationResult {
  if (!record(value) || !record(value.receipt) || typeof value.receipt.hash !== 'string' || value.receipt.status !== 'locally_saved') throw new Error('Host did not confirm a local save')
  return { state: parseState(value.state), receipt: { hash: value.receipt.hash, status: 'locally_saved', ...(typeof value.receipt.annotationId === 'string' ? { annotationId: value.receipt.annotationId } : {}) } }
}

export function statusText(state: HostState): string {
  if (!state.document) return state.error ? `Empty replica · ${state.error.message}` : 'Empty replica · Connect to recover document'
  const { pending, sync, causalGap } = state.status
  const saved = pending > 0 ? `Saved locally · ${pending} pending` : 'Saved locally'
  if (state.error) return `${saved} · ${state.error.message}`
  if (sync.kind === 'paused') return `${saved} · Paused: ${sync.reason}`
  if (causalGap) return `${saved} · Waiting for earlier changes`
  if (state.connection === 'disconnected') return `${saved} · Offline`
  if (sync.kind === 'caught_up' && pending === 0) return 'Published · Up to date'
  if (sync.kind === 'syncing') return `${saved} · Syncing`
  return saved
}
