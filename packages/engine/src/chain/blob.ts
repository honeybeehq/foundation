import type { EnvelopeRecord } from '../types.js'
import { computeEnvelopeHash } from './envelope.js'
import { loadChain, type FdnChain } from './chain.js'

export function encodeBlob(envelope: EnvelopeRecord, bytes: Uint8Array): Uint8Array {
  // Fixed key order — deterministic bytes for a logically-identical envelope
  // (mirrors util.ts's stableStringify rationale, inlined here since the
  // envelope's shape is small and fixed rather than arbitrary JSON).
  const json = JSON.stringify({
    hash: envelope.hash,
    prevHash: envelope.prevHash,
    author: envelope.author,
    message: envelope.message,
    specVersion: envelope.specVersion,
  })
  const jsonBytes = new TextEncoder().encode(json)
  const out = new Uint8Array(4 + jsonBytes.length + bytes.length)
  new DataView(out.buffer).setUint32(0, jsonBytes.length, true)
  out.set(jsonBytes, 4)
  out.set(bytes, 4 + jsonBytes.length)
  return out
}

export function decodeBlob(buf: Uint8Array): { envelope: EnvelopeRecord; bytes: Uint8Array } {
  if (buf.length < 4) throw new Error('truncated change frame')
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const jsonLen = view.getUint32(0, true)
  if (jsonLen === 0 || jsonLen > buf.length - 5) throw new Error('invalid change frame length')
  const jsonBytes = buf.subarray(4, 4 + jsonLen)
  const updateBytes = buf.subarray(4 + jsonLen)
  const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes)) as EnvelopeRecord
  if (!envelope || typeof envelope.author !== 'string' || typeof envelope.message !== 'string' || typeof envelope.specVersion !== 'string' ||
      !(envelope.prevHash === null || (typeof envelope.prevHash === 'string' && /^[a-f0-9]{64}$/.test(envelope.prevHash))) ||
      typeof envelope.hash !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.hash)) throw new Error('invalid envelope')
  if (computeEnvelopeHash(envelope.prevHash, envelope.author, envelope.message, envelope.specVersion, updateBytes) !== envelope.hash) throw new Error('envelope hash mismatch')
  return { envelope, bytes: updateBytes }
}

/** Validate in isolation: pending causal updates or foreign history never reach the live chain. */
export function importChangeBlobs(chain: FdnChain, blobs: Uint8Array[]): number {
  const scratch = loadChain(chain.save())
  const known = new Set(scratch.changes().map(c => c.envelope.hash))
  const missing = blobs.map(decodeBlob).filter(c => !known.has(c.envelope.hash))
  const expected = new Set([...known, ...missing.map(c => c.envelope.hash)])
  for (const c of missing) {
    if (c.envelope.prevHash === null || !expected.has(c.envelope.prevHash)) throw new Error('missing causal history or foreign genesis')
    scratch.importUpdate(c.bytes)
  }
  if (scratch.docId() !== chain.docId()) throw new Error('document identity mismatch')
  const actual = scratch.changes()
  if (actual.length !== expected.size || actual.some(c => !expected.has(c.envelope.hash))) throw new Error('incomplete causal history or envelope mismatch')
  if (!scratch.verify().ok) throw new Error('candidate chain failed history verification')
  for (const c of missing) chain.importUpdate(c.bytes)
  return new Set(missing.map(c => c.envelope.hash)).size
}
