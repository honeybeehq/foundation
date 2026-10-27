import { constants, brotliCompressSync, brotliDecompressSync } from 'node:zlib'
import { stableStringify } from './util.js'
import { createHash } from 'node:crypto'
import { decodeImportBlobMeta, LoroDoc } from 'loro-crdt'
import type { Change } from 'loro-crdt'

export function encodeOriginalUpdates(entries: [string, string][]): { encoding: string; data: string } {
  const frames = entries.map(([, value]) => {
    const bytes = Buffer.from(value, 'base64'), frame = Buffer.allocUnsafe(4 + bytes.length)
    frame.writeUInt32LE(bytes.length); bytes.copy(frame, 4)
    return frame
  })
  const raw = Buffer.concat(frames)
  return { encoding: 'brotli-v1', data: brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_GENERIC, [constants.BROTLI_PARAM_LGWIN]: 22, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }).toString('base64') }
}

function decodeOriginalBytes(value: unknown): Uint8Array[] {
  if (value === null || typeof value !== 'object' || !('encoding' in value) || value.encoding !== 'brotli-v1' || !('data' in value) || typeof value.data !== 'string') throw new Error('unsupported original update encoding')
  const raw = brotliDecompressSync(Buffer.from(value.data, 'base64'), { maxOutputLength: 128 * 1024 * 1024 })
  const entries: Uint8Array[] = []
  for (let offset = 0; offset < raw.length;) {
    if (offset + 4 > raw.length) throw new Error('truncated original update frame')
    const length = raw.readUInt32LE(offset); offset += 4
    if (length === 0 || offset + length > raw.length) throw new Error('invalid original update frame')
    entries.push(raw.subarray(offset, offset + length)); offset += length
  }
  return entries
}

export function decodeOriginalUpdates(value: unknown): [string, string][] {
  return decodeOriginalBytes(value).map(bytes => [updateKey(bytes), Buffer.from(bytes).toString('base64')])
}

export const changeKey = (change: Pick<Change, 'peer' | 'counter' | 'length'>): string => `${change.peer}:${change.counter}:${change.length}`

/** A wire update is one whole change. Its first exact encoding owns its identity. */
function updateKey(bytes: Uint8Array): string {
  const meta = decodeImportBlobMeta(bytes, true)
  const start = [...meta.partialStartVersionVector.toJSON()]
  const end = [...meta.partialEndVersionVector.toJSON()]
  if (meta.mode !== 'update' || meta.changeNum !== 1 || start.length !== 1 || end.length !== 1 || start[0]![0] !== end[0]![0] || end[0]![1] <= start[0]![1]) throw new Error('expected one complete change update')
  return `${start[0]![0]}:${start[0]![1]}:${end[0]![1] - start[0]![1]}`
}

/** Stored outside Loro: native re-encoding can reorder dependencies and change hashes. */
export class OriginalUpdates {
  private readonly updates = new Map<string, Uint8Array>()
  private readonly spans = new Map<string, Array<{ start: number; end: number; key: string }>>()

  private check(key: string, bytes: Uint8Array): void {
    const previous = this.updates.get(key)
    if (previous && !Buffer.from(previous).equals(bytes)) {
      const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
      throw new Error(`conflicting original update bytes for ${key} (bytes SHA-256 ${digest(previous)} vs ${digest(bytes)}); restore this replica from a healthy archived chain before syncing`)
    }
    const [peer, counter, length] = key.split(':')
    const start = Number(counter), end = start + Number(length)
    if (this.spans.get(peer!)?.some(span => span.key !== key && start < span.end && span.start < end)) throw new Error(`overlapping change span ${key}; partial changes cannot replace archived commits`)
  }

  private store(key: string, bytes: Uint8Array): void {
    if (this.updates.has(key)) return
    const [peer, counter, length] = key.split(':')
    const start = Number(counter)
    this.updates.set(key, Uint8Array.from(bytes))
    const spans = this.spans.get(peer!) ?? []
    spans.push({ start, end: start + Number(length), key })
    this.spans.set(peer!, spans)
  }

  record(bytes: Uint8Array, accept?: () => void): void {
    const key = updateKey(bytes)
    this.check(key, bytes)
    accept?.()
    this.store(key, bytes)
  }

  bytes(doc: LoroDoc, change: Pick<Change, 'peer' | 'counter' | 'length'>): Uint8Array {
    const key = changeKey(change)
    let bytes = this.updates.get(key)
    if (!bytes) {
      bytes = doc.export({ mode: 'updates-in-range', spans: [{ id: { peer: change.peer, counter: change.counter }, len: change.length }] })
      this.record(bytes)
    }
    return this.updates.get(key)!
  }

  copyFrom(other: OriginalUpdates): void {
    // Check every conflict before accepting any of the incoming archive.
    for (const [key, bytes] of other.updates) this.check(key, bytes)
    for (const [key, bytes] of other.updates) this.store(key, bytes)
  }

  assertCoverage(changes: Change[]): void {
    const keys = new Set(changes.map(changeKey))
    if (this.updates.size !== keys.size || [...this.updates.keys()].some(key => !keys.has(key))) throw new Error('cannot save incomplete causal history')
  }

  save(changes: Change[]): [string, string][] {
    this.assertCoverage(changes)
    return [...this.updates].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, bytes]) => [key, Buffer.from(bytes).toString('base64')])
  }

  load(encoded: unknown, changes: Change[]): void {
    // The outer SHA-256 storage seal has already checked these local
    // frame bytes against accidental corruption. Full replay is in verify(),
    // mandatory at receive boundaries. Avoid reparsing each native blob here.
    const bytes = decodeOriginalBytes(encoded)
    const keys = changes.map(changeKey).sort()
    if (bytes.length !== keys.length) throw new Error('incomplete original update archive')
    for (const [i, key] of keys.entries()) this.store(key, bytes[i]!)
    this.assertCoverage(changes)
  }

  validate(snapshot: LoroDoc, changes: Change[]): void {
    this.assertCoverage(changes)
    for (const [key, bytes] of this.updates) if (updateKey(bytes) !== key) throw new Error('original update span mismatch')
    const replay = new LoroDoc()
    replay.importBatch(changes.map(change => this.updates.get(changeKey(change))!))
    const history = (doc: LoroDoc) => stableStringify(doc.exportJsonUpdates(undefined, undefined, false).changes.map(change => ({ ...change, deps: [...change.deps].sort() })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    if (history(replay) !== history(snapshot)) throw new Error('original update archive does not match snapshot history')
  }
}
