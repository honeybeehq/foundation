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
  invertOp,
  loadChain,
  normalizeDocument,
  parseDocument,
  projectDocument,
  stableStringify,
  validateDocument,
} from 'foundation-engine'
import type { EnvelopeRecord, FdnChain, FdnDocument, PatchOp, ReportLine } from 'foundation-engine'
import { parseClientMessage, SESSION_PROTOCOL } from 'foundation-protocol'
import type { Cause, ClientMessage, DocumentView, FaultCode, ResultCode, ServiceMessage } from 'foundation-protocol'
import { injectDocIdAttr, readDocIdAttr } from '../docid.js'
import { skeletonDocumentEmpty, titleFromName } from '../commands/new.js'
import { readBytesIfPresent, readTextIfPresent, sameBytes, writeAtomic } from './disk.js'

export interface SessionOptions {
  path: string
  create?: boolean
  title?: string
  author?: string
  send: (message: ServiceMessage) => void
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

interface Step {
  label: string
  revert: PatchOp[]
  guard: string
}

interface Failure {
  code: ResultCode
  message: string
}

const FILE_AUTHOR = 'file'

export function createSession(options: SessionOptions): Session {
  return new DesignSession(options)
}

export function canonicalText(doc: FdnDocument): string {
  return projectDocument(normalizeDocument(doc))
}

class DesignSession implements Session {
  readonly done: Promise<number>
  private finish!: (code: number) => void
  private readonly path: string
  private readonly chainPath: string
  private readonly log: (line: string) => void
  private phase: 'waiting' | 'open' | 'closed' = 'waiting'
  private author = ''
  private actor = `session:${randomUUID()}`
  private chain: FdnChain | null = null
  private doc!: FdnDocument
  private docText = ''
  private docId: string | null = null
  private issues: ReportLine[] = []
  private rev = 0
  private undoStack: Step[] = []
  private redoStack: Step[] = []
  private diskText: string | null = null
  private diskTextCanonical: string | null = null
  private diskChain: Uint8Array | null = null
  private view: { states: Array<string | null>; components: boolean } = { states: [], components: false }
  private sentBakes = new Map<string, string>()
  private watcher: FSWatcher | null = null
  private poller: NodeJS.Timeout | null = null
  private seenSignature = ''
  private pendingSync: NodeJS.Timeout | null = null

  constructor(private readonly options: SessionOptions) {
    this.path = resolve(options.path)
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
      this.dispatch(message)
    } catch (err) {
      this.log(`internal error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
      this.fault('internal', err instanceof Error ? err.message : String(err), this.phase === 'waiting' ? 1 : null)
    }
  }

  sync(): void {
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
    this.watcher?.close()
    this.watcher = null
    if (this.poller) clearInterval(this.poller)
    this.poller = null
    this.finish(code)
  }

  private fault(code: FaultCode, message: string, exitCode: number | null): void {
    this.options.send({ t: 'fault', code, message })
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
        this.view = { states: [...new Set(message.states)], components: message.components }
        this.sentBakes.clear()
        return this.sendBakes()
      case 'commit':
        return this.commit(message)
      case 'undo':
        return this.step(message.id, 'undo')
      case 'redo':
        return this.step(message.id, 'redo')
      case 'log':
        return this.options.send({ t: 'log', id: message.id, entries: this.chain ? this.chain.log().reverse().slice(0, message.limit) : [] })
    }
  }

  private hello(message: Extract<ClientMessage, { t: 'hello' }>): void {
    if (message.protocol !== SESSION_PROTOCOL) {
      return this.fault('protocol', `protocol ${message.protocol} is not supported; this service speaks ${SESSION_PROTOCOL}`, 2)
    }
    this.author = message.author || this.options.author || `user:${process.env.USER ?? 'unknown'}`
    const created = this.open()
    if (created === null) return
    this.phase = 'open'
    this.rev = 1
    this.options.send({
      t: 'welcome',
      protocol: SESSION_PROTOCOL,
      path: this.path,
      docId: this.docId,
      chain: this.chain !== null,
      created,
      ...this.documentView(),
    })
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
    const incoming = parseDocument(text).doc
    this.diskText = text
    this.diskTextCanonical = canonicalText(incoming)
    this.diskChain = chainBytes
    this.docId = this.chain?.docId() ?? readDocIdAttr(text)
    if (!this.chain) {
      this.setDoc(normalizeDocument(incoming))
      return false
    }
    this.setDoc(this.chain.doc())
    if (this.diskTextCanonical !== this.docText) {
      this.ingest(this.doc, incoming)
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
    this.chain = createChain(doc, { author: this.author, message: 'init' }, { actor: this.actor, docId: this.docId })
    this.setDoc(this.chain.doc())
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      this.persist()
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

  private renderText(): string {
    const text = projectDocument(this.doc)
    return this.docId ? injectDocIdAttr(text, this.docId) : text
  }

  private persist(): void {
    this.persistChain()
    this.persistText()
  }

  private persistChain(): void {
    if (!this.chain) return
    const bytes = this.chain.save()
    writeAtomic(this.chainPath, bytes)
    this.diskChain = bytes
    this.seenSignature = this.fileSignature()
  }

  private persistText(): void {
    if (this.diskTextCanonical === this.docText && this.diskText !== null) return
    const text = this.renderText()
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
        const theirLog = theirs.log()
        if (this.chain && this.chain.log()[0]?.hash === theirLog[0]?.hash) {
          this.chain.merge(theirs)
          chainAhead = this.chain.log().length > theirLog.length
        } else {
          if (this.chain) this.log(`${this.chainPath} was replaced by an unrelated chain; adopting it`)
          this.chain = loadChain(chainBytes, { actor: this.actor })
        }
        this.docId = this.chain.docId() ?? this.docId
        this.setDoc(this.chain.doc())
        author = theirLog.at(-1)?.author ?? null
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
      const base = this.diskText === null ? this.doc : parseDocument(this.diskText).doc
      const incoming = parseDocument(text).doc
      const incomingCanonical = canonicalText(incoming)
      const baseCanonical = this.diskTextCanonical
      this.diskText = text
      this.diskTextCanonical = incomingCanonical
      if (incomingCanonical !== baseCanonical && incomingCanonical !== this.docText) {
        if (this.ingest(base, incoming)) {
          chainAhead = true
          author = FILE_AUTHOR
        }
      }
    }

    if (chainAhead) this.persistChain()
    if (author !== undefined) this.persistText()
    return author
  }

  private ingest(base: FdnDocument, incoming: FdnDocument): boolean {
    const ops = diffPatch(base, incoming)
    const patch = ops === null ? applyPatch(this.doc, [{ op: 'replace-document', doc: incoming }]) : applyPatch(this.doc, ops, { lenient: true })
    if (!patch.ok || patch.applied.length === 0) return false
    if (this.chain) {
      this.chain.apply({ author: FILE_AUTHOR, message: 'ingest' }, patch.applied)
      this.setDoc(this.chain.doc())
    } else {
      this.setDoc(normalizeDocument(patch.doc))
    }
    return true
  }

  private commit(message: Extract<ClientMessage, { t: 'commit' }>): void {
    this.syncAndAnnounce()
    if (message.ops.length === 0) return this.reject(message.id, { code: 'invalid-op', message: 'commit has no ops' })
    if (message.base > this.rev) return this.reject(message.id, { code: 'invalid-op', message: `base ${message.base} is ahead of rev ${this.rev}` })
    const patch = applyPatch(this.doc, message.ops)
    if (!patch.ok) return this.reject(message.id, patch.error)
    const label = message.label || 'Edit'
    const failure = this.record(patch.applied, label)
    if (failure) return this.reject(message.id, failure)
    this.undoStack.push({ label, revert: patch.inverse, guard: this.guard(patch.inverse) })
    this.redoStack = []
    this.accept(message.id, { kind: 'commit', id: message.id, author: this.author })
  }

  private step(id: string, direction: 'undo' | 'redo'): void {
    this.syncAndAnnounce()
    const from = direction === 'undo' ? this.undoStack : this.redoStack
    const to = direction === 'undo' ? this.redoStack : this.undoStack
    const step = from.pop()
    if (!step) return this.reject(id, { code: direction === 'undo' ? 'nothing-to-undo' : 'nothing-to-redo', message: `nothing to ${direction}` })
    const conflict = { code: 'conflict' as const, message: `"${step.label}" can no longer be ${direction === 'undo' ? 'undone' : 'redone'}: those nodes changed since` }
    if (this.guard(step.revert) !== step.guard) return this.reject(id, conflict)
    const patch = applyPatch(this.doc, step.revert)
    if (!patch.ok) return this.reject(id, conflict)
    const failure = this.record(patch.applied, `${direction === 'undo' ? 'Undo' : 'Redo'} ${step.label}`)
    if (failure) {
      from.push(step)
      return this.reject(id, failure)
    }
    to.push({ label: step.label, revert: patch.inverse, guard: this.guard(patch.inverse) })
    this.accept(id, { kind: direction, id, author: this.author })
  }

  private record(ops: PatchOp[], message: string): Failure | null {
    const snapshot = this.chain?.save() ?? null
    const previous = { doc: this.doc, docId: this.docId }
    try {
      if (!this.chain) {
        this.docId ??= readDocIdAttr(this.diskText ?? '') ?? randomUUID()
        this.chain = createChain(this.doc, { author: this.author, message: 'init' }, { actor: this.actor, docId: this.docId })
      }
      this.chain.apply({ author: this.author, message }, ops)
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

  private guard(revert: PatchOp[]): string {
    const index = indexNodes(this.doc.body)
    return stableStringify(
      revert.map((op) => {
        const current = invertOp(op, this.doc, index)
        return current !== null && current !== 'fallback' && current.op === 'insert-node' ? { ...current, index: 0 } : current
      }),
    )
  }

  private syncAndAnnounce(): void {
    const before = this.docText
    const author = this.syncFromDisk()
    if (this.docText !== before) this.announce({ kind: 'external', author: author ?? null })
  }

  private accept(id: string, cause: Cause): void {
    this.announce(cause)
    this.options.send({ t: 'result', id, ok: true, rev: this.rev })
  }

  private reject(id: string, failure: Failure): void {
    this.options.send({ t: 'result', id, ok: false, code: failure.code, message: failure.message })
  }

  private announce(cause: Cause): void {
    this.rev++
    this.options.send({ t: 'doc', cause, ...this.documentView() })
    this.sendBakes()
  }

  private documentView(): DocumentView {
    const top = (stack: Step[]): string | null => stack.at(-1)?.label ?? null
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

  private sendBakes(): void {
    for (const state of this.view.states) {
      const baked = this.bake(() => bakeEditorDocument(this.doc, state === null ? undefined : { state }))
      if (this.changed(`state:${JSON.stringify(state)}`, baked)) this.options.send({ t: 'baked', rev: this.rev, state, ...baked })
    }
    if (!this.view.components) return
    for (const component of this.doc.components) {
      const baked = this.bake(() => bakeEditorComponent(this.doc, component.name))
      if (this.changed(`component:${component.name}`, baked)) this.options.send({ t: 'component', rev: this.rev, name: component.name, ...baked })
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
      this.seenSignature = this.fileSignature()
      this.sync()
    } catch (err) {
      this.log(`sync failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
      this.fault('internal', `sync failed: ${err instanceof Error ? err.message : String(err)}`, null)
    }
  }
}
