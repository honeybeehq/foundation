import { bakeImpact, mergeBakeImpact, type BakeImpact } from './bake-impact.js'
import { PlacementError } from './placement.js'
import { expandComponentOp } from './components.js'
import { expandSessionOps } from './token-modes.js'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, statSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import {
  applyPatch,
  bakeEditorComponent,
  bakeEditorDocument,
  createChain,
  diffPatch,
  indexNodes,
  loadChain,
  normalizeDocument,
  parseDocument,
  prepareChain,
  stableStringify,
  validateDocument,
  validateTokenCollections,
} from 'foundation-engine'
import type { EnvelopeRecord, FdnChain, FdnDocument, InstanceSwapReport, PatchOp, ReportLine } from 'foundation-engine'
import { parseClientMessage, SESSION_PROTOCOL } from 'foundation-protocol'
import type { Cause, ClientMessage, DocumentView, FaultCode, ResultCode, ServiceMessage } from 'foundation-protocol'
import { withWallTime } from '../change-meta.js'
import { readDocIdAttr } from '../docid.js'
import { skeletonDocumentEmpty, titleFromName } from '../commands/new.js'
import { canonicalText, documentText, persistDocument, projectedText, projectionVersion, recoverDocument, sourceBase, readBytesIfPresent, readTextIfPresent, sameBytes, writeAtomic } from '../disk.js'
import { DocumentBusyError, documentPath, isDocumentLocked, withDocumentLock } from '../document-lock.js'
import { oppositeStep, undoOps, undoStep, type UndoStep } from './undo.js'

export interface SessionOptions {
  path: string
  create?: boolean
  title?: string
  author?: string
  send: (message: ServiceMessage) => void
  flush?: () => Promise<void>
  log?: (line: string) => void
  watch?: boolean
  settleMs?: number
  pollMs?: number
}

export interface Session {
  receive(line: string): void
  sync(): void
  close(): void
  readonly done: Promise<number>
}

interface Failure {
  code: ResultCode
  message: string
}

const FILE_AUTHOR = 'file'

export function createSession(options: SessionOptions): Session {
  return new DesignSession(options)
}

class DesignSession implements Session {
  readonly done: Promise<number>
  private finish!: (code: number) => void
  private readonly path: string
  private readonly displayPath: string
  private readonly chainPath: string
  private readonly log: (line: string) => void
  private phase: 'waiting' | 'open' | 'closed' = 'waiting'
  private author = ''
  private earlyResult = false
  private actor = `session:${randomUUID()}`
  private chain: FdnChain | null = null
  private preparedChain: { text: string; actor: string; docId: string; finish: ReturnType<typeof prepareChain> } | null = null
  private doc!: FdnDocument
  private docText = ''
  private docId: string | null = null
  private issues: ReportLine[] = []
  private rev = 0
  private undoStack: UndoStep[] = []
  private redoStack: UndoStep[] = []
  private invalidExternalTokens: string | null = null
  private diskText: string | null = null
  private diskTextCanonical: string | null = null
  private diskChain: Uint8Array | null = null
  private view: { states: Array<string | null>; components: boolean; bakeDiffs: boolean } = { states: [], components: false, bakeDiffs: false }
  private sentBakes = new Map<string, string>()
  private pendingBakeImpact: BakeImpact | null = null
  private stateBakes = new Map<string | null, { rev: number; html: string }>()
  private watcher: FSWatcher | null = null
  private poller: NodeJS.Timeout | null = null
  private seenSignature = ''
  private pendingSync: NodeJS.Timeout | null = null
  private locked = false
  private outbox: Array<() => void> = []
  private pendingHello: NodeJS.Timeout | null = null
  private helloWaitStarted: number | null = null

  constructor(private readonly options: SessionOptions) {
    this.path = documentPath(options.path)
    this.displayPath = resolve(options.path)
    this.chainPath = `${this.path}.chain`
    this.log = options.log ?? (() => {})
    this.done = new Promise((resolveDone) => {
      this.finish = resolveDone
    })
  }

  receive(line: string): void {
    if (this.phase === 'closed' || line.trim() === '') return
    const message = parseClientMessage(line)
    if (!message) {
      this.fault('protocol', `malformed message: ${line.slice(0, 200)}`, this.phase === 'waiting' ? 2 : null)
      return
    }
    try {
      if (message.t === 'hello' && this.options.create) mkdirSync(dirname(this.path), { recursive: true })
      this.inTransaction(() => this.dispatch(message), message.t === 'hello' ? 0 : 100)
    } catch (err) {
      if (err instanceof DocumentBusyError && this.phase === 'waiting') {
        this.helloWaitStarted ??= performance.now()
        if (performance.now() - this.helloWaitStarted >= 5000) return this.fault('unreadable', err.message, 1)
        this.pendingHello = setTimeout(() => { this.pendingHello = null; this.receive(line) }, 25)
        return
      }
      this.log(`internal error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
      if ('id' in message) return this.reject(message.id, { code: 'write-failed', message: err instanceof Error ? err.message : String(err) })
      this.fault('internal', err instanceof Error ? err.message : String(err), this.phase === 'waiting' ? 1 : null)
    }
  }

  sync(): void {
    if (this.phase !== 'open') return
    if (!this.locked && isDocumentLocked(this.path)) { this.scheduleSync(); return }
    if (this.locked) return this.syncLocked()
    try {
      this.inTransaction(() => this.syncLocked(), 0)
      this.seenSignature = this.fileSignature()
    } catch (err) {
      if (!(err instanceof DocumentBusyError)) throw err
      this.scheduleSync()
    }
  }

  private inTransaction(run: () => void, timeoutMs = 100): void {
    this.outbox = []
    try {
      withDocumentLock(this.path, () => {
        this.locked = true
        recoverDocument(this.path)
        run()
      }, timeoutMs)
    } finally {
      this.locked = false
      const outbox = this.outbox
      this.outbox = []
      for (const send of outbox) send()
    }
  }

  private emit(message: ServiceMessage): void {
    if (this.locked) this.outbox.push(() => this.options.send(message))
    else this.options.send(message)
  }

  private syncLocked(): void {
    if (this.phase !== 'open') return
    if (this.pendingSync) clearTimeout(this.pendingSync)
    this.pendingSync = null
    const before = this.docText
    const author = this.syncFromDisk()
    if (this.docText !== before) this.announce({ kind: 'external', author: author ?? null })
  }

  close(): void {
    if (this.phase === 'closed') return
    if (this.phase === 'open' && this.pendingSync) {
      try {
        this.sync()
      } catch (err) {
        this.log(`final sync failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    this.end(0)
  }

  private end(code: number): void {
    this.phase = 'closed'
    if (this.pendingSync) clearTimeout(this.pendingSync)
    this.pendingSync = null
    if (this.pendingHello) clearTimeout(this.pendingHello)
    this.pendingHello = null
    this.watcher?.close()
    this.watcher = null
    if (this.poller) clearInterval(this.poller)
    this.poller = null
    this.finish(code)
  }

  private fault(code: FaultCode, message: string, exitCode: number | null): void {
    this.emit({ t: 'fault', code, message })
    if (exitCode !== null) this.end(exitCode)
  }

  private dispatch(message: ClientMessage): void {
    if (this.phase === 'waiting') {
      if (message.t !== 'hello') return this.fault('protocol', `expected hello, got ${message.t}`, 2)
      return this.hello(message)
    }
    switch (message.t) {
      case 'hello':
        return this.fault('protocol', 'hello was already received', null)
      case 'view':
        this.view = { states: [...new Set(message.states)], components: message.components, bakeDiffs: message.bakeDiffs === true }
        this.sentBakes.clear()
        this.stateBakes.clear()
        return this.sendBakes()
      case 'preview-instance-swap': {
        this.syncAndAnnounce()
        try {
          const reports: InstanceSwapReport[] = []
          expandComponentOp(this.doc, { ...message.op, previewRev: undefined, previewSignature: undefined }, reports)
          return this.emit({ t: 'instance-swap-preview', id: message.id, rev: this.rev, report: reports[0]! })
        } catch (err) {
          return this.reject(message.id, { code: 'invalid-op', message: err instanceof Error ? err.message : String(err) })
        }
      }
      case 'commit':
        return this.commit(message)
      case 'anchor':
        return this.anchor(message)
      case 'undo':
        return this.step(message.id, 'undo')
      case 'redo':
        return this.step(message.id, 'redo')
      case 'log':
        this.syncAndAnnounce()
        try {
          const page = this.chain?.logPage(message) ?? { entries: [], nextCursor: null, latestCursor: null, hasMore: false }
          return this.emit({ t: 'log', id: message.id, ...page })
        } catch (err) {
          return this.reject(message.id, { code: 'invalid-op', message: err instanceof Error ? err.message : String(err) })
        }
    }
  }

  private hello(message: Extract<ClientMessage, { t: 'hello' }>): void {
    if (message.protocol !== SESSION_PROTOCOL) {
      return this.fault('protocol', `protocol ${message.protocol} is not supported; this service speaks ${SESSION_PROTOCOL}`, 2)
    }
    this.author = message.author || this.options.author || `user:${process.env.USER ?? 'unknown'}`
    this.earlyResult = message.earlyResult === true
    const created = this.open()
    if (created === null) return
    if (this.earlyResult && !this.chain && !this.invalidExternalTokens && this.docId) {
      this.preparedChain = { text: this.docText, actor: this.actor, docId: this.docId, finish: prepareChain(this.doc, { actor: this.actor, docId: this.docId }) }
    }
    this.phase = 'open'
    this.rev = 1
    this.emit({
      t: 'welcome',
      protocol: SESSION_PROTOCOL,
      path: this.displayPath,
      docId: this.docId,
      chain: this.chain !== null,
      created,
      ...this.documentView(),
    })
    if (this.invalidExternalTokens) this.fault('unreadable', this.invalidExternalTokens, null)
    if (this.options.watch !== false) this.startWatching()
    this.sendBakes()
  }

  private open(): boolean | null {
    let text: string | null
    try {
      text = readTextIfPresent(this.path)
    } catch (err) {
      this.fault('unreadable', `could not read ${this.path}: ${err instanceof Error ? err.message : String(err)}`, 1)
      return null
    }
    if (text === null) return this.scaffold()

    let chainBytes: Uint8Array | null
    try {
      chainBytes = readBytesIfPresent(this.chainPath)
      this.chain = chainBytes ? loadChain(chainBytes, { actor: this.actor }) : null
    } catch (err) {
      this.fault('unreadable', `could not read ${this.chainPath}: ${err instanceof Error ? err.message : String(err)}`, 1)
      return null
    }
    const parsed = parseDocument(text)
    const incoming = parsed.doc
    this.diskText = text
    this.diskTextCanonical = canonicalText(incoming)
    this.diskChain = chainBytes
    this.docId = this.chain?.docId() ?? readDocIdAttr(text)
    const issue = parsed.report.lines.find((line) => line.code === 'invalid-data-json' || ['malformed-component-set', 'malformed-instance-overrides', 'misplaced-override-wrapper'].includes(line.code)) ?? validateTokenCollections(incoming)[0]
    if (issue) {
      this.invalidExternalTokens = `external metadata is invalid; source preserved and commits blocked until repaired: ${issue.message}`
      this.setDoc(this.chain ? this.chain.doc() : normalizeDocument(incoming))
      return false
    }
    if (!this.chain) {
      this.setDoc(normalizeDocument(incoming))
      return false
    }
    this.setDoc(this.chain.doc())
    if (this.diskTextCanonical !== this.docText) {
      try { this.ingest(sourceBase(this.chain, text, this.path), incoming) } catch (err) {
        this.blockExternal(err)
        return false
      }
      this.persist()
    }
    return false
  }

  private scaffold(): boolean | null {
    if (!this.options.create) {
      this.fault('not-found', `${this.path} does not exist (pass --create to start a new document)`, 1)
      return null
    }
    if (existsSync(this.chainPath)) {
      this.fault('exists', `${this.chainPath} already exists without its document; refusing to scaffold over it`, 1)
      return null
    }
    const doc = skeletonDocumentEmpty(this.options.title ?? titleFromName(this.path))
    this.docId = randomUUID()
    this.chain = createChain(doc, withWallTime({ author: this.author, message: 'init' }), { actor: this.actor, docId: this.docId })
    this.setDoc(this.chain.doc())
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      this.persist(false)
    } catch (err) {
      this.fault('unreadable', `could not create ${this.path}: ${err instanceof Error ? err.message : String(err)}`, 1)
      return null
    }
    return true
  }

  private setDoc(doc: FdnDocument): void {
    this.doc = doc
    this.docText = canonicalText(doc)
    this.issues = validateDocument(doc).issues
  }

  private persist(protect = true): void {
    if (!this.chain || this.invalidExternalTokens) return
    const text = this.diskTextCanonical === this.docText && this.diskText !== null ? this.diskText : this.chain ? projectedText(this.chain, this.docId, this.docText) : documentText(this.doc, this.docId)
    this.diskChain = persistDocument(this.path, this.chain, text, protect)
    this.diskText = text
    this.diskTextCanonical = this.docText
    this.seenSignature = this.fileSignature()
  }

  private persistText(): void {
    if (this.invalidExternalTokens) return
    if (this.diskTextCanonical === this.docText && this.diskText !== null) return
    const text = this.chain ? projectedText(this.chain, this.docId, this.docText) : documentText(this.doc, this.docId)
    writeAtomic(this.path, text)
    this.diskText = text
    this.diskTextCanonical = this.docText
    this.seenSignature = this.fileSignature()
  }

  private syncFromDisk(): string | null | undefined {
    let author: string | null | undefined
    let chainAhead = false

    const chainBytes = readBytesIfPresent(this.chainPath)
    if (chainBytes && !sameBytes(chainBytes, this.diskChain)) {
      this.diskChain = chainBytes
      try {
        const theirs = loadChain(chainBytes)
        if (this.chain && this.chain.historyRoot() === theirs.historyRoot()) {
          this.chain.merge(theirs)
          chainAhead = this.chain.versionRef() !== theirs.versionRef()
        } else {
          if (this.chain) this.log(`${this.chainPath} was replaced by an unrelated chain; adopting it`)
          this.undoStack = []
          this.redoStack = []
          this.chain = loadChain(chainBytes, { actor: this.actor })
        }
        this.docId = this.chain.docId() ?? this.docId
        this.setDoc(this.chain.doc())
        author = theirs.head().author
      } catch (err) {
        this.log(`ignoring unreadable ${this.chainPath}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    let text: string | null = null
    try {
      text = readTextIfPresent(this.path)
    } catch (err) {
      this.log(`ignoring unreadable ${this.path}: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (text !== null && text !== this.diskText) {
      const previousText = this.diskText
      const wasBlocked = this.invalidExternalTokens
      const parsed = parseDocument(text)
      const incoming = parsed.doc
      const incomingCanonical = canonicalText(incoming)
      const baseCanonical = this.diskTextCanonical
      this.diskText = text
      this.diskTextCanonical = incomingCanonical
      const issue = parsed.report.lines.find((line) => line.code === 'invalid-data-json' || ['malformed-component-set', 'malformed-instance-overrides', 'misplaced-override-wrapper'].includes(line.code)) ?? validateTokenCollections(incoming)[0]
      if (issue) {
        const message = `external metadata is invalid; source preserved and commits blocked until repaired: ${issue.message}`
        if (this.invalidExternalTokens !== message) this.fault('unreadable', message, null)
        this.invalidExternalTokens = message
      } else {
        try {
          const version = projectionVersion(text)
          const base = this.chain && (version || existsSync(`${this.path}.chain.projection`)) ? sourceBase(this.chain, text, this.path) : wasBlocked || previousText === null ? this.doc : parseDocument(previousText).doc
          this.invalidExternalTokens = null
          if ((wasBlocked || incomingCanonical !== baseCanonical) && incomingCanonical !== this.docText) {
            if (this.ingest(base, incoming)) {
              chainAhead = true
              author = FILE_AUTHOR
            }
          }
        } catch (err) { this.blockExternal(err) }
      }
    }

    if (chainAhead) this.persist()
    else if (author !== undefined) this.persistText()
    return author
  }

  private blockExternal(err: unknown): void {
    const message = `external changes blocked; source preserved: ${err instanceof Error ? err.message : String(err)}; run foundation chain recover ${JSON.stringify(this.path)} to back up unapplied text and restore the projection`
    if (this.invalidExternalTokens !== message && this.phase === 'open') this.fault('unreadable', message, null)
    this.invalidExternalTokens = message
  }

  private ingest(base: FdnDocument, incoming: FdnDocument): boolean {
    const declarations = applyPatch(incoming, [
      ...incoming.data.map((data): PatchOp => ({ op: 'set-data', data })),
      ...incoming.viewports.map((viewport): PatchOp => ({ op: 'set-viewport', viewport })),
    ])
    const ops = diffPatch(base, incoming)
    const patch = !declarations.ok ? declarations : ops === null ? { ok: false as const, error: { code: 'invalid-op' as const, message: 'external edit cannot be expressed as granular changes' } } : applyPatch(this.doc, ops)
    if (!patch.ok) {
      this.invalidExternalTokens = `external changes cannot be applied; source preserved and commits blocked until repaired: ${patch.error.message}`
      if (this.phase === 'open') this.fault('unreadable', this.invalidExternalTokens, null)
      return false
    }
    if (patch.applied.length === 0) return false
    if (this.chain) {
      this.chain.apply(withWallTime({ author: FILE_AUTHOR, message: 'ingest' }), patch.applied)
      this.setDoc(this.chain.doc())
    } else {
      this.setDoc(normalizeDocument(patch.doc))
    }
    return true
  }

  private commit(message: Extract<ClientMessage, { t: 'commit' }>): void {
    this.syncAndAnnounce()
    if (this.invalidExternalTokens) return this.reject(message.id, { code: 'invalid-op', message: this.invalidExternalTokens })
    if (message.ops.length === 0) return this.reject(message.id, { code: 'invalid-op', message: 'commit has no ops' })
    if (message.base > this.rev) return this.reject(message.id, { code: 'invalid-op', message: `base ${message.base} is ahead of rev ${this.rev}` })
    const componentSwaps: InstanceSwapReport[] = []
    for (const op of message.ops) if ('previewRev' in op && op.previewRev !== undefined && (op.previewRev > this.rev || op.previewRev < this.rev && !op.previewSignature)) return this.reject(message.id, { code: 'conflict', message: 'swap preview is stale; preview the swap again' })
    let ops: PatchOp[]
    let singlePatch: ReturnType<typeof applyPatch> | undefined
    try {
      const primitive: PatchOp[] = []
      let target = this.doc
      for (const op of message.ops) {
        const expanded = op.op === 'replace-document' ? diffPatch(target, op.doc) : [op]
        if (expanded === null) throw new Error('edit cannot be expressed as granular changes')
        const checked = applyPatch(target, expandSessionOps(target, expanded, componentSwaps), { validateComponents: message.ops.length === 1 })
        if (!checked.ok) throw new PlacementError(checked.error.code, checked.error.message)
        primitive.push(...checked.applied)
        singlePatch = checked
        target = checked.doc
      }
      ops = primitive
    } catch (err) {
      return this.reject(message.id, { code: err instanceof PlacementError ? err.code : err instanceof Error && err.message.startsWith('swap preview changed') ? 'conflict' : 'invalid-op', message: err instanceof Error ? err.message : String(err) })
    }
    const patch = message.ops.length === 1 && singlePatch ? singlePatch : applyPatch(this.doc, ops)
    if (!patch.ok) return this.reject(message.id, patch.error)
    if (patch.inverse.length === 0 && canonicalText(patch.doc) === this.docText) {
      this.emit({ t: 'result', id: message.id, ok: true, rev: this.rev, ...(componentSwaps.length ? { componentSwaps } : {}) })
      return
    }
    const before = this.doc
    const label = message.label || 'Edit'
    const failure = this.record(patch.applied, label)
    if (failure) return this.reject(message.id, failure)
    this.undoStack.push(undoStep(label, patch.inverse, before, this.doc, patch.applied))
    this.redoStack = []
    this.accept(message.id, { kind: 'commit', id: message.id, author: this.author }, bakeImpact(this.doc, patch.applied), componentSwaps)
  }

  private step(id: string, direction: 'undo' | 'redo'): void {
    this.syncAndAnnounce()
    if (this.invalidExternalTokens) return this.reject(id, { code: 'invalid-op', message: this.invalidExternalTokens })
    const from = direction === 'undo' ? this.undoStack : this.redoStack
    const to = direction === 'undo' ? this.redoStack : this.undoStack
    const step = from.at(-1)
    if (!step) return this.reject(id, { code: direction === 'undo' ? 'nothing-to-undo' : 'nothing-to-redo', message: `nothing to ${direction}` })
    const conflict = { code: 'conflict' as const, message: `"${step.label}" can no longer be ${direction === 'undo' ? 'undone' : 'redone'}: those nodes changed since` }
    let ops: PatchOp[]
    try { ops = undoOps(step, this.doc) } catch (err) {
      from.pop()
      return this.reject(id, { ...conflict, message: `${err instanceof Error ? err.message : String(err)}; skipped this undo step` })
    }
    const before = this.doc
    const patch = applyPatch(this.doc, ops)
    if (!patch.ok) {
      from.pop()
      return this.reject(id, { code: 'conflict', message: `${patch.error.message}; skipped this undo step` })
    }
    const failure = this.record(patch.applied, `${direction === 'undo' ? 'Undo' : 'Redo'} ${step.label}`)
    if (failure) {
      return this.reject(id, failure)
    }
    from.pop()
    to.push(oppositeStep(step, before, this.doc))
    this.accept(id, { kind: direction, id, author: this.author }, bakeImpact(this.doc, patch.applied))
  }

  private anchor(message: Extract<ClientMessage, { t: 'anchor' }>): void {
    this.syncAndAnnounce()
    if (!message.name.trim()) return this.reject(message.id, { code: 'invalid-op', message: 'anchor name must not be empty' })
    const label = `Anchor ${message.name}`
    const failure = this.transact(chain => { chain.anchor(message.name, withWallTime({ author: this.author, message: label })) })
    if (failure) return this.reject(message.id, failure)
    this.accept(message.id, { kind: 'commit', id: message.id, author: this.author }, bakeImpact(this.doc, []))
  }

  private record(ops: PatchOp[], message: string): Failure | null {
    return this.transact(chain => { chain.apply(withWallTime({ author: this.author, message }), ops) })
  }

  private transact(mutate: (chain: FdnChain) => void): Failure | null {
    if (this.invalidExternalTokens) return { code: 'invalid-op', message: this.invalidExternalTokens }
    const snapshot = this.chain?.save() ?? null
    const previous = { doc: this.doc, docId: this.docId }
    try {
      if (!this.chain) {
        this.docId ??= readDocIdAttr(this.diskText ?? '') ?? randomUUID()
        const prepared = this.preparedChain
        this.preparedChain = null
        const meta = withWallTime({ author: this.author, message: 'init' })
        this.chain = prepared?.text === this.docText && prepared.actor === this.actor && prepared.docId === this.docId
          ? prepared.finish(meta)
          : createChain(this.doc, meta, { actor: this.actor, docId: this.docId })
      }
      mutate(this.chain)
      this.setDoc(this.chain.doc())
    } catch (err) {
      this.rollback(snapshot, previous)
      return { code: 'invalid-op', message: err instanceof Error ? err.message : String(err) }
    }
    try {
      this.persist()
      return null
    } catch (err) {
      this.rollback(snapshot, previous)
      return { code: 'write-failed', message: err instanceof Error ? err.message : String(err) }
    }
  }

  private rollback(snapshot: Uint8Array | null, previous: { doc: FdnDocument; docId: string | null }): void {
    this.actor = `session:${randomUUID()}`
    this.chain = snapshot ? loadChain(snapshot, { actor: this.actor }) : null
    this.docId = previous.docId
    this.setDoc(previous.doc)
  }

  private syncAndAnnounce(): void {
    const before = this.docText
    const author = this.syncFromDisk()
    if (this.docText !== before) this.announce({ kind: 'external', author: author ?? null })
  }

  private accept(id: string, cause: Cause, impact: BakeImpact, componentSwaps: InstanceSwapReport[] = []): void {
    if (this.earlyResult) {
      this.rev++
      this.emit({ t: 'doc', cause, ...this.documentView() })
      this.emit({ t: 'result', id, ok: true, rev: this.rev, ...(componentSwaps.length ? { componentSwaps } : {}) })
      this.sendBakes(impact)
      return
    }
    this.announce(cause, impact)
    this.emit({ t: 'result', id, ok: true, rev: this.rev, ...(componentSwaps.length ? { componentSwaps } : {}) })
  }

  private reject(id: string, failure: Failure): void {
    this.emit({ t: 'result', id, ok: false, code: failure.code, message: failure.message })
  }

  private announce(cause: Cause, impact?: BakeImpact): void {
    this.rev++
    this.emit({ t: 'doc', cause, ...this.documentView() })
    this.sendBakes(impact)
  }

  private documentView(): DocumentView {
    const top = (stack: UndoStep[]): string | null => stack.at(-1)?.label ?? null
    return {
      rev: this.rev,
      doc: this.doc,
      head: this.head(),
      history: { canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0, undoLabel: top(this.undoStack), redoLabel: top(this.redoStack) },
      issues: this.issues,
    }
  }

  private head(): EnvelopeRecord | null {
    if (!this.chain) return null
    try {
      return this.chain.head()
    } catch {
      return null
    }
  }

  private sendBakes(impact: BakeImpact = { states: null, components: true }): void {
    const doc = this.doc
    const rev = this.rev
    if (this.earlyResult) this.pendingBakeImpact = this.pendingBakeImpact ? mergeBakeImpact(this.pendingBakeImpact, impact) : impact
    const send = (): void => {
      if (!this.earlyResult) return this.sendBakesFor(doc, rev, impact)
      void Promise.resolve(this.options.flush?.()).then(() => {
        if (this.phase !== 'open' || this.rev !== rev) return
        const pending = this.pendingBakeImpact ?? impact
        this.pendingBakeImpact = null
        this.sendBakesFor(doc, rev, pending)
      }).catch(err => {
        this.log(`bake delivery failed: ${err instanceof Error ? err.message : String(err)}`)
      })
    }
    if (this.locked) this.outbox.push(send)
    else send()
  }

  private sendBakesFor(doc: FdnDocument, rev: number, impact: BakeImpact): void {
    for (const state of this.view.states) {
      if (impact.states && !impact.states.has(state)) continue
      const baked = this.bake(() => bakeEditorDocument(doc, state === null ? undefined : { state }))
      if (!this.changed(`state:${JSON.stringify(state)}`, baked)) continue
      const previous = this.stateBakes.get(state)
      this.stateBakes.set(state, { rev, html: baked.html })
      if (this.view.bakeDiffs && previous) {
        const diff = htmlDiff(previous.html, baked.html)
        const delta: ServiceMessage = { t: 'baked-diff', rev, state, baseRev: previous.rev, ...diff, report: baked.report }
        if (JSON.stringify(delta).length < baked.html.length) {
          this.emit(delta)
          continue
        }
      }
      this.emit({ t: 'baked', rev, state, ...baked })
    }
    if (!this.view.components || !impact.components) return
    for (const component of [...doc.components, ...(doc.componentSets ?? [])]) {
      const baked = this.bake(() => bakeEditorComponent(doc, component.name))
      if (this.changed(`component:${component.name}`, baked)) this.emit({ t: 'component', rev: rev, name: component.name, ...baked })
    }
  }

  private bake(run: () => { html: string; report: { lines: ReportLine[] } }): { html: string; report: ReportLine[] } {
    try {
      const { html, report } = run()
      return { html, report: report.lines }
    } catch (err) {
      return { html: '', report: [{ code: 'bake-failed', severity: 'error', message: err instanceof Error ? err.message : String(err) }] }
    }
  }

  private changed(key: string, baked: { html: string; report: ReportLine[] }): boolean {
    const signature = `${baked.html}\u0000${JSON.stringify(baked.report)}`
    if (this.sentBakes.get(key) === signature) return false
    this.sentBakes.set(key, signature)
    return true
  }

  private startWatching(): void {
    const names = new Set([basename(this.path), basename(this.chainPath)])
    this.watcher = watch(dirname(this.path), (_event, filename) => {
      if (filename === null || names.has(filename)) this.scheduleSync()
    })
    this.watcher.on('error', (err) => this.log(`watch error: ${err.message}`))
    this.seenSignature = this.fileSignature()
    this.poller = setInterval(() => {
      if (this.fileSignature() !== this.seenSignature) this.scheduleSync()
    }, this.options.pollMs ?? 1000)
  }

  private scheduleSync(): void {
    if (this.pendingSync) clearTimeout(this.pendingSync)
    this.pendingSync = setTimeout(() => this.syncSafely(), this.options.settleMs ?? 60)
  }

  private fileSignature(): string {
    return [this.path, this.chainPath]
      .map((path) => {
        try {
          const stat = statSync(path)
          return `${stat.ino}:${stat.size}:${stat.mtimeMs}`
        } catch {
          return '-'
        }
      })
      .join('|')
  }

  private syncSafely(): void {
    try {
      this.sync()
    } catch (err) {
      this.log(`sync failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
      this.fault('internal', `sync failed: ${err instanceof Error ? err.message : String(err)}`, null)
    }
  }
}

function htmlDiff(before: string, after: string): { start: number; deleteCount: number; insert: string } {
  let start = 0
  const limit = Math.min(before.length, after.length)
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start++
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
    endBefore--
    endAfter--
  }
  return { start, deleteCount: endBefore - start, insert: after.slice(start, endAfter) }
}
