import { parseMutation, parseState, record, type HostConfiguration, type HostState, type MutationResult } from './contract.js'
import type { FdnAnnotation, PatchOp } from '../../engine/src/types.js'

class HostResponseError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export function loopbackURL(input: string): string {
  const url = new URL(input)
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Host URL must be a plain loopback HTTP origin')
  return url.origin
}

/** One main-process client owns one service session. No renderer supplied paths or auth. */
export class HostClient {
  private sessionId?: string
  private opening?: Promise<HostState>
  private readonly origin: string
  constructor(private readonly config: HostConfiguration, private readonly request: typeof fetch = fetch) { this.origin = loopbackURL(config.url) }

  private async json(path: string, body?: unknown): Promise<unknown> {
    const response = await this.request(`${this.origin}${path}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(/\/(sync|disconnect|close|connect)$/.test(path) ? 65_000 : 30_000),
      headers: { Authorization: `Bearer ${this.config.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const value: unknown = await response.json()
    if (!response.ok) {
      if (record(value) && record(value.error) && typeof value.error.message === 'string') throw new HostResponseError(response.status, `${String(value.error.code)}: ${value.error.message}`)
      throw new HostResponseError(response.status, `Host request failed (${response.status})`)
    }
    return value
  }
  async open(): Promise<HostState> {
    if (this.sessionId) {
      try { return await this.state() }
      catch (error) {
        if (!(error instanceof HostResponseError) || error.status !== 404) throw error
        this.sessionId = undefined
      }
    }
    this.opening ??= this.json('/v1/replicas/open', { directory: this.config.directory, docId: this.config.docId, author: this.config.author, ...(this.config.seed ? { seed: this.config.seed } : {}) }).then(value => {
      if (!record(value) || typeof value.sessionId !== 'string') throw new Error('Host did not open a replica session')
      const state = parseState(value.state)
      this.sessionId = value.sessionId
      return state
    }).finally(() => { this.opening = undefined })
    return this.opening
  }
  private path(action: string): string {
    if (!this.sessionId) throw new Error('Replica session is not open')
    return `/v1/replicas/${encodeURIComponent(this.sessionId)}/${action}`
  }
  async state(): Promise<HostState> { return parseState(await this.json(this.path('state'))) }
  async commit(ops: PatchOp[], message: string): Promise<MutationResult> {
    if (!Array.isArray(ops) || !ops.length || ops.some(op => !record(op) || op.op === 'replace-document')) throw new Error('Desktop edits must be granular operations')
    return parseMutation(await this.json(this.path('commit'), { meta: { author: this.config.author, message }, ops }))
  }
  async annotate(input: Omit<FdnAnnotation, 'id' | 'status'>): Promise<MutationResult> {
    if (!input.text.trim()) throw new Error('Write a comment first')
    return parseMutation(await this.json(this.path('annotate'), { meta: { author: this.config.author, message: 'Add design comment' }, input }))
  }
  async connection(action: 'connect' | 'disconnect' | 'sync'): Promise<HostState> {
    if (!['connect', 'disconnect', 'sync'].includes(action)) throw new Error('Unknown connection action')
    const result = await this.json(this.path(action), {})
    if (!record(result)) throw new Error('Invalid host response')
    return parseState(result.state)
  }
  async export(directory: string): Promise<{ html: string; chain: string }> {
    const result = await this.json(this.path('export'), { directory })
    if (!record(result) || !record(result.files) || typeof result.files.html !== 'string' || typeof result.files.chain !== 'string') throw new Error('Host did not confirm exported files')
    return { html: result.files.html, chain: result.files.chain }
  }
  async close(): Promise<void> {
    if (this.opening) await this.opening.catch(() => undefined)
    if (!this.sessionId) return
    await this.json(this.path('close'), {})
    this.sessionId = undefined
  }
}
