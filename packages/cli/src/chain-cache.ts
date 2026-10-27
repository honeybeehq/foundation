import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadChain as engineLoadChain } from 'foundation-engine'

// Receipts live outside repositories: a foreign file cannot vouch for itself.
const cacheDir = () => join(process.env.FOUNDATION_CACHE_DIR ?? join(homedir(), '.foundation'), 'verified-chains-v2')
const cache = {
  has(seal: string): boolean { try { return existsSync(join(cacheDir(), seal)) } catch { return false } },
  add(seal: string): void {
    try { mkdirSync(cacheDir(), { recursive: true }); writeFileSync(join(cacheDir(), seal), '', { flag: 'wx', mode: 0o600 }) } catch { /* An unavailable cache costs replay, never skips verification. */ }
  },
}

export function loadChain(bytes: Uint8Array, opts?: { actor?: string }) {
  return engineLoadChain(bytes, { ...opts, storageCache: cache })
}

/** Only called on bytes just produced by engine save(), after persistence succeeds. */
export function rememberSavedChain(bytes: Uint8Array): void {
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true)
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + n)))
  if (header.version === 2 && typeof header.seal === 'string' && /^[a-f0-9]{64}$/.test(header.seal)) cache.add(header.seal)
}
