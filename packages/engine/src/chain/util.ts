import { createHash } from 'node:crypto'

/** Deterministically use Loro's full 64-bit peer space without JS number rounding.
 * Explicit actors enable reproducible replay; default actors are fresh UUIDs.
 * Existing snapshots retain their recorded peers and history unchanged. */
export function derivePeerId(actor: string): `${number}` {
  // u64::MAX is reserved by Loro. Reduce into its supported peer range.
  const peer = createHash('sha256').update(actor).digest().readBigUInt64BE(0) % 0xffffffffffffffffn
  return peer.toString() as `${number}`
}

/** A monotonic, deterministic clock for change timestamps (never Date.now()). */
export class DeterministicClock {
  private t = 0
  next(): number {
    this.t += 1
    return this.t
  }
}

/**
 * Deterministic JSON serialization: object keys sorted recursively, so
 * logically-identical values always produce byte-identical JSON — required
 * both for hash determinism and to let Loro's "same value = no-op" map
 * optimization actually fire on unchanged whole-object writes.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value))
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value !== null && typeof value === 'object') {
    const input = value as Record<string, unknown>
    const sorted: Record<string, unknown> = Object.create(null)
    for (const key of Object.keys(input).sort()) sorted[key] = sortKeysDeep(input[key])
    return sorted
  }
  return value
}

/** Compare two decimal-string PeerIDs numerically (they can exceed 2^53). */
export function comparePeerIds(a: string, b: string): number {
  if (a === b) return 0
  const ba = BigInt(a)
  const bb = BigInt(b)
  return ba < bb ? -1 : 1
}
