/** Browser/Node-safe UUIDs for independent writers. Never use a document-local counter. */
function uuid(): string {
  if (!globalThis.crypto?.getRandomValues) throw new Error('Foundation id minting requires Web Crypto (crypto.getRandomValues)')
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function mintNodeId(): string { return `n-${uuid()}` }

/** Existing aN ids remain opaque/readable; the optional argument keeps old callers compatible. */
export function mintAnnotationId(_existing?: readonly unknown[]): string { return `a-${uuid()}` }
