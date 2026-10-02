import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { diffPatch, loadChain, normalizeDocument, projectDocument } from 'foundation-engine'
import type { ChangeMeta, EnvelopeRecord, FdnChain, FdnDocument } from 'foundation-engine'
import { injectDocIdAttr } from './docid.js'

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
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`)
  try {
    writeFileSync(temp, data)
    renameSync(temp, path)
  } catch (err) {
    rmSync(temp, { force: true })
    throw err
  }
}

export function canonicalText(doc: FdnDocument): string {
  return projectDocument(normalizeDocument(doc))
}

export function documentText(doc: FdnDocument, docId: string | null): string {
  const text = projectDocument(doc)
  return docId ? injectDocIdAttr(text, docId) : text
}

export type DocumentCommit =
  | { status: 'committed'; chain: FdnChain; envelope: EnvelopeRecord }
  | { status: 'no-op'; chain: FdnChain }

export function commitDocument(chainPath: string, meta: ChangeMeta, target: FdnDocument): DocumentCommit {
  for (let attempt = 1; ; attempt++) {
    const before = readFileSync(chainPath)
    const chain = loadChain(before, { actor: `${meta.author}#${randomUUID()}` })
    const current = chain.doc()
    if (canonicalText(current) === canonicalText(target)) return { status: 'no-op', chain }
    const ops = diffPatch(current, target)
    const envelope = chain.apply(meta, ops && ops.length > 0 ? ops : [{ op: 'replace-document', doc: target }])
    const latest = readBytesIfPresent(chainPath)
    if (!sameBytes(latest, before)) {
      if (attempt < 5) continue
      if (latest) chain.merge(loadChain(latest))
    }
    writeAtomic(chainPath, chain.save())
    return { status: 'committed', chain, envelope }
  }
}
