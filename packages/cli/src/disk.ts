import { rememberAuthored } from './history-origin.js'
import { syncTrace, syncTraceSpan } from './sync-trace.js'
import { selectedChainFormat } from './chain-format.js'
import { loadChain, rememberSavedChain } from './chain-cache.js'
import { parseForWrite } from './parse-write.js'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { diffPatch, normalizeDocument, parseDocument, projectDocument } from 'foundation-engine'
import type { ChangeMeta, EnvelopeRecord, FdnChain, FdnDocument } from 'foundation-engine'
import { withWallTime } from './change-meta.js'
import { injectDocIdAttr, readDocIdAttr } from './docid.js'
import { documentPath, withDocumentLock } from './document-lock.js'

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

export function readBytesIfPresent(path: string): Uint8Array | null {
  try {
    return readFileSync(path)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

export function readTextIfPresent(path: string): string | null {
  const bytes = readBytesIfPresent(path)
  return bytes === null ? null : new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null || b === null) return a === b
  return Buffer.compare(a, b) === 0
}

export function writeAtomic(path: string, data: string | Uint8Array): void {
  const bytes = typeof data === 'string' ? Buffer.from(data) : data
  if (sameBytes(readBytesIfPresent(path), bytes)) return
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`)
  try {
    writeFileSync(temp, data)
    renameSync(temp, path)
  } catch (err) {
    rmSync(temp, { force: true })
    throw err
  }
}

export function syncDocument(file: string): void {
  for (const path of [`${file}.chain`, file, `${file}.chain.projection`]) {
    const descriptor = openSync(path, 'r')
    try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
  }
  const directory = openSync(dirname(file), 'r')
  try { fsyncSync(directory) } finally { closeSync(directory) }
}

export function writeUntrackedDocument(file: string, text: string, create = false): void {
  file = documentPath(file)
  withDocumentLock(file, () => {
    if (readBytesIfPresent(`${file}.chain`) !== null || (create && readBytesIfPresent(file) !== null)) throw new Error(`document changed while preparing the write: ${file}; retry without overwriting it`)
    writeAtomic(file, text)
  })
}

export function canonicalText(doc: FdnDocument): string {
  return projectDocument(normalizeDocument(doc))
}

export function documentText(doc: FdnDocument, docId: string | null): string {
  const text = projectDocument(doc)
  return docId ? injectDocIdAttr(text, docId) : text
}

export function projectionVersion(source: string): string | null {
  const tag = /<fdn-doc\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/.exec(source)?.[0] ?? ''
  return /\sdata-fdn-version="([A-Za-z0-9_-]+)"/.exec(tag)?.[1] ?? null
}

export function projectedText(chain: FdnChain, docId: string | null = chain.docId() ?? null, canonical?: string): string {
  const text = canonical ?? projectDocument(chain.doc())
  return (docId ? injectDocIdAttr(text, docId) : text).replace('<fdn-doc', `<fdn-doc data-fdn-version="${chain.versionRef()}"`)
}

export function sourceBase(chain: FdnChain, source: string, file?: string): FdnDocument {
  const ref = projectionVersion(source)
  const receipt = file ? readTextIfPresent(`${file}.chain.projection`) : null
  if (!ref && receipt && JSON.parse(receipt).protected) {
    const latest = loadChain(readFileSync(`${file}.chain`)).doc()
    const projected = parseDocument(canonicalText(latest)).doc
    if (canonicalText(parseDocument(source).doc) === canonicalText(projected)) return projected
    throw new Error(`missing data-fdn-version: preserve it from the source; run foundation chain recover ${JSON.stringify(file)} to back up unapplied text and restore the latest projection`)
  }
  const doc = ref && ref !== chain.versionRef() ? chain.docAt(ref) : chain.doc()
  return parseDocument(canonicalText(doc)).doc
}

export type DocumentCommit =
  | { status: 'committed'; chain: FdnChain; envelope: EnvelopeRecord }
  | { status: 'no-op'; chain: FdnChain }

export function recoverDocument(file: string): void {
  const pendingPath = `${file}.chain.pending`
  const pendingBytes = readTextIfPresent(pendingPath)
  if (pendingBytes === null) return
  const pending = JSON.parse(pendingBytes) as { before: string | null; after: string; chainHash: string; protected?: boolean }
  const chain = readBytesIfPresent(`${file}.chain`)
  if (chain && createHash('sha256').update(chain).digest('hex') === pending.chainHash) {
    const text = readTextIfPresent(file)
    if (text !== pending.before && text !== pending.after) throw new Error(`interrupted save and external text edits; run foundation chain recover ${JSON.stringify(file)} to back up both and restore the latest projection`)
    if (text !== pending.after) writeAtomic(file, pending.after)
    writeAtomic(`${file}.chain.projection`, JSON.stringify({ version: projectionVersion(pending.after), protected: pending.protected ?? true }))
  }
  unlinkSync(pendingPath)
}

export function persistDocument(file: string, chain: FdnChain, text = projectedText(chain, chain.docId() ?? readDocIdAttr(readTextIfPresent(file) ?? '')), protectedProjection = true): Uint8Array {
  const finish = syncTraceSpan('save', () => ({ docId: chain.docId(), hash: chain.head().hash }))
  let ok = false
  try {
    if (selectedChainFormat(file, chain.storageFormat()) === 2) chain.upgradeStorage()
    const bytes = chain.save()
    const receipt = JSON.stringify({ version: projectionVersion(text), protected: protectedProjection })
    if (sameBytes(readBytesIfPresent(`${file}.chain`), bytes) && readTextIfPresent(file) === text) {
      writeAtomic(`${file}.chain.projection`, receipt)
      rememberAuthored(chain)
      ok = true; return bytes
    }
    const pendingPath = `${file}.chain.pending`
    writeAtomic(pendingPath, JSON.stringify({ before: readTextIfPresent(file), after: text, chainHash: createHash('sha256').update(bytes).digest('hex'), protected: protectedProjection }))
    writeAtomic(`${file}.chain`, bytes)
    syncTrace('save.chain-written', () => ({ docId: chain.docId(), hash: chain.head().hash }))
    writeAtomic(file, text)
    writeAtomic(`${file}.chain.projection`, receipt)
    unlinkSync(pendingPath)
    rememberSavedChain(bytes)
    rememberAuthored(chain)
    ok = true; return bytes
  } finally { finish({ ok }) }
}

function ingestCurrentSource(file: string, chain: FdnChain, source: string): boolean {
  const parsed = parseForWrite(source)
  if (parsed.report.lines.some(line => line.severity === 'error')) throw new Error(`invalid external document; run foundation chain recover ${JSON.stringify(file)} to back it up and restore the projection`)
  const ops = diffPatch(sourceBase(chain, source, file), parsed.doc)
  if (ops === null) throw new Error(`external edit cannot be expressed as granular changes; run foundation chain recover ${JSON.stringify(file)}`)
  if (ops.length) chain.apply(withWallTime({ author: 'file', message: 'ingest' }), ops)
  return ops.length > 0
}

export function updateDocument<T>(file: string, mutate: (chain: FdnChain) => T, onlyIfChanged = false): T {
  file = documentPath(file)
  return withDocumentLock(file, () => {
    recoverDocument(file)
    const chain = loadChain(readFileSync(`${file}.chain`), { actor: `writer:${randomUUID()}` })
    const source = readTextIfPresent(file)
    if (source !== null) {
      ingestCurrentSource(file, chain, source)
    }
    const before = chain.versionRef()
    const beforeFormat = chain.storageFormat()
    const result = mutate(chain)
    if (!onlyIfChanged || chain.storageFormat() !== beforeFormat || chain.versionRef() !== before || (source !== null && projectedText(chain) !== source)) persistDocument(file, chain)
    return result
  })
}

export function commitDocument(chainPath: string, meta: ChangeMeta, target: FdnDocument, base?: FdnDocument, source?: string | null): DocumentCommit {
  const file = documentPath(chainPath.slice(0, -'.chain'.length))
  chainPath = `${file}.chain`
  source ??= readTextIfPresent(file)
  const initial = base ?? loadChain(readFileSync(chainPath)).doc()
  const ops = diffPatch(initial, target)
  if (ops === null) throw new Error('edit cannot be expressed as granular changes')
  return withDocumentLock(file, () => {
    recoverDocument(file)
    const chain = loadChain(readFileSync(chainPath), { actor: `${meta.author}#${randomUUID()}` })
    const currentSource = readTextIfPresent(file)
    const ingested = currentSource !== null && currentSource !== source && ingestCurrentSource(file, chain, currentSource)
    if (ops.length === 0 || canonicalText(chain.doc()) === canonicalText(target)) {
      const source = readTextIfPresent(file)
      const normalized = documentText(chain.doc(), chain.docId() ?? readDocIdAttr(source ?? ''))
      if (ingested || currentSource?.replace(/ data-fdn-version="[^"]*"/, '') !== normalized) persistDocument(file, chain)
      return { status: 'no-op', chain }
    }
    const envelope = chain.apply(withWallTime(meta), ops)
    persistDocument(file, chain)
    return { status: 'committed', chain, envelope }
  })
}

/** Materialization uses the same G16 lock and pending-save receipt as local writers. */
export function materializeDocument(file: string, incoming: FdnChain): FdnChain {
  file = documentPath(file)
  return withDocumentLock(file, () => {
    const bytes = readBytesIfPresent(`${file}.chain`), source = readTextIfPresent(file)
    const sourceId = source === null ? null : readDocIdAttr(source)
    if (sourceId !== null && sourceId !== incoming.docId()) throw new Error('path-conflict: target contains another design')
    if (source !== null && bytes === null) throw new Error('path-conflict: target contains an untracked document')
    let chain = bytes === null ? incoming : loadChain(bytes, { actor: `materialize:${randomUUID()}` })
    if (chain.docId() !== incoming.docId()) throw new Error('path-conflict: target chain belongs to another design')
    if (bytes !== null && chain.changes().find(change => change.envelope.prevHash === null)?.envelope.hash !== incoming.changes().find(change => change.envelope.prevHash === null)?.envelope.hash) throw new Error('path-conflict: target has unrelated history')
    recoverDocument(file)
    if (bytes !== null) {
      chain = loadChain(readFileSync(`${file}.chain`), { actor: `materialize:${randomUUID()}` })
      const current = readTextIfPresent(file)
      if (current !== null) ingestCurrentSource(file, chain, current)
      chain.merge(incoming)
    }
    if (!chain.verify().ok) throw new Error('materialized chain failed history verification')
    persistDocument(file, chain)
    return chain
  })
}
