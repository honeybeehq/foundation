import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { hostname } from 'node:os'
import type { FdnChain } from 'foundation-engine'
import { writeAtomic } from '../disk.js'
import { replicaRoot, type LiveDesign } from '../sync-store.js'
import { CombBridge, validateAppendReceipt } from './bridge.js'
import type { CombConfig } from './daemon.js'

export interface NodeRef { id: string; name: string }
export interface CatalogueRecord {
  version: 1
  workspaceId: string
  productId: string
  docId: string
  repoRelativePath: string
  title: string
  originNode: NodeRef
  replicaId: string
  generation: number
  headHash: string
  lastAuthor: string | null
  lastWallTime: number | null
  lastAgentEdit: { author: `agent:${string}`; originNode: NodeRef; hash: string; wallTime: number | null } | null
  deleted: boolean
}
interface CatalogueState { replicaId: string; generation: number; pending: CatalogueRecord | null; acknowledged: string | null }
export function catalogueLog(workspace: string): string { return `foundation-${createHash('sha256').update(`foundation/${workspace}/catalogue`).digest('hex')}` }
export function catalogueBytes(record: CatalogueRecord): Uint8Array { return new TextEncoder().encode(JSON.stringify(record)) }
export function catalogueHash(record: CatalogueRecord): string { return createHash('sha256').update(catalogueBytes(record)).digest('hex') }
export function confinedRelativePath(root: string, file: string): string {
  const path = relative(realpathSync(root), realpathSync(file)).split(sep).join('/')
  if (isAbsolute(path) || !path.endsWith('.fdn.html') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('catalogue path must be a confined repo-relative .fdn.html path')
  return path
}
function repositoryRoot(design: LiveDesign): string {
  return design.repoRoot ?? process.env.FOUNDATION_REPO_ROOT ?? execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dirname(design.file), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
export function catalogueRecord(design: LiveDesign, chain: FdnChain, replicaId: string, generation: number, owner?: NodeRef): CatalogueRecord {
  const root = repositoryRoot(design)
  const head = chain.head(), millis = head.wallTime ? Date.parse(head.wallTime) : NaN
  const node = owner ?? { id: process.env.FOUNDATION_NODE_ID ?? '', name: process.env.FOUNDATION_NODE_NAME ?? hostname() }
  if (!node.id || !node.name) throw new Error('catalogue requires config.node or FOUNDATION_NODE_ID with the real machine id')
  return {
    version: 1, workspaceId: design.workspace, productId: design.product, docId: design.docId,
    repoRelativePath: confinedRelativePath(root, design.file), title: (chain.doc().title ?? basename(design.file, '.fdn.html')).slice(0, 4096),
    originNode: node, replicaId, generation, headHash: head.hash,
    lastAuthor: head.author, lastWallTime: Number.isFinite(millis) ? millis : null,
    // Authorship/hash validation is not publisher authentication. Populate only once
    // an authenticated provenance adapter can supply agent/node binding.
    lastAgentEdit: null, deleted: false,
  }
}
/** Each live path owns its generation/outbox. Closing it never publishes a tombstone. */
export class CataloguePublisher {
  private state: CatalogueState
  private path: string
  constructor(private design: LiveDesign, key: string, private config: CombConfig) {
    this.design = { ...design, repoRoot: repositoryRoot(design) }
    const dir = join(replicaRoot(), 'catalogue'); mkdirSync(dir, { recursive: true }); this.path = join(dir, `${key}.json`)
    try {
      this.state = JSON.parse(readFileSync(this.path, 'utf8')) as CatalogueState
      if (!this.state || typeof this.state.replicaId !== 'string' || !Number.isSafeInteger(this.state.generation) || this.state.generation < 0 || !(this.state.acknowledged === null || (typeof this.state.acknowledged === 'string' && /^[a-f0-9]{64}$/.test(this.state.acknowledged))) || !(this.state.pending === null || (this.state.pending.version === 1 && this.state.pending.replicaId === this.state.replicaId && this.state.pending.generation === this.state.generation && this.state.pending.workspaceId === design.workspace && this.state.pending.productId === design.product && this.state.pending.docId === design.docId && typeof this.state.pending.repoRelativePath === 'string' && typeof this.state.pending.headHash === 'string'))) throw new Error('invalid catalogue checkpoint')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      this.state = { replicaId: randomUUID(), generation: 0, pending: null, acknowledged: null }; this.save()
    }
  }
  private save(next = this.state): void { writeAtomic(this.path, JSON.stringify(next)); this.state = next }
  private async publishPending(): Promise<void> {
    const record = this.state.pending
    if (!record) return
    const hash = catalogueHash(record)
    if (this.state.acknowledged === hash) return
    const writer = new CombBridge(this.config.binary, this.config.args)
    try {
      await writer.hello()
      const log = catalogueLog(this.design.workspace)
      const receipt = await writer.request('append', { log, idempotency_key: hash, payload_hex: Buffer.from(catalogueBytes(record)).toString('hex') })
      validateAppendReceipt(receipt, log)
      this.save({ ...this.state, acknowledged: hash })
    } finally { await writer.finish() }
  }
  async update(chain: FdnChain): Promise<void> {
    // Retry the saved generation first, including an interrupted acknowledgement.
    await this.publishPending()
    const candidate = catalogueRecord(this.design, chain, this.state.replicaId, this.state.generation, this.config.node)
    if (this.state.pending && catalogueHash(candidate) === catalogueHash(this.state.pending)) return
    if (this.state.generation === Number.MAX_SAFE_INTEGER) throw new Error('catalogue generation exhausted')
    candidate.generation = this.state.generation + 1
    this.save({ ...this.state, generation: candidate.generation, pending: candidate })
    await this.publishPending()
  }
}

interface CatalogueJob { design: LiveDesign; chain: FdnChain; report: (error: string | null) => void; nextAt: number; backoff: number }
/** One catalogue writer per workspace; metadata delivery never holds up document uploads. */
export class CatalogueQueue {
  private jobs = new Map<string, CatalogueJob>()
  private publishers = new Map<string, { registration: string; publisher: CataloguePublisher }>()
  private runners = new Map<string, Promise<void>>()
  constructor(private config: CombConfig, private signal: AbortSignal, private log: (message: string) => void = () => {}) {}
  private report(job: CatalogueJob, error: string | null): void {
    try { job.report(error) } catch (err) { this.log(`catalogue status write: ${String(err)}`) }
  }
  enqueue(key: string, design: LiveDesign, chain: FdnChain, report: (error: string | null) => void): void {
    const previous = this.jobs.get(key)
    this.jobs.set(key, { design, chain, report, nextAt: previous?.nextAt ?? 0, backoff: previous?.backoff ?? 250 })
    if (!this.runners.has(design.workspace)) {
      const task = Promise.resolve().then(() => this.drain(design.workspace)).finally(() => this.runners.delete(design.workspace))
      this.runners.set(design.workspace, task)
    }
  }
  private async drain(workspace: string): Promise<void> {
    while (!this.signal.aborted) {
      const entries = [...this.jobs].filter(([, job]) => job.design.workspace === workspace)
      if (!entries.length) return
      const entry = entries.find(([, job]) => job.nextAt <= Date.now())
      if (!entry) { await new Promise(resolve => setTimeout(resolve, 250)); continue }
      const [key, job] = entry; this.jobs.delete(key)
      try {
        const registration = JSON.stringify(job.design)
        let cached = this.publishers.get(key)
        if (!cached || cached.registration !== registration) {
          cached = { registration, publisher: new CataloguePublisher(job.design, key, this.config) }; this.publishers.set(key, cached)
        }
        await cached.publisher.update(job.chain); this.report(job, null)
      } catch (err) {
        this.report(job, String(err))
        const latest = this.jobs.get(key) ?? job
        latest.nextAt = Date.now() + job.backoff; latest.backoff = Math.min(job.backoff * 2, 10000)
        this.jobs.set(key, latest)
      }
    }
  }
  async close(): Promise<void> { await Promise.all(this.runners.values()) }
}
