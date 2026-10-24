import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface InventoryEntry {
  source: string
  path: string
  realpath: string | null
  executable: boolean
  sourceSha: string | null
  stampPath: string | null
  packageVersion: string | null
  dirty: boolean | null
  sessionProtocols: string[] | null
  documentFormats: string[] | null
  chainFormats: number[] | null
  defaultChainFormat: number | null
  artboardWriteSafe: boolean | 'unknown'
  error?: string
}

export function readable(path: string): string | null {
  try {
    // Bound reads, and do not block on devices or FIFOs supplied through PATH.
    const stat = statSync(path)
    if (!stat.isFile() || stat.size > 1024 * 1024) return null
    return readFileSync(path, 'utf8')
  } catch { return null }
}

export function inspect(path: string, source: string): InventoryEntry {
  const entry: InventoryEntry = { source, path, realpath: null, executable: false, sourceSha: null, stampPath: null, packageVersion: null, dirty: null, sessionProtocols: null, documentFormats: null, chainFormats: null, defaultChainFormat: null, artboardWriteSafe: 'unknown' }
  try { entry.realpath = realpathSync(path) } catch { entry.error = 'missing or inaccessible'; return entry }
  try { accessSync(path, constants.X_OK); entry.executable = statSync(path).isFile() } catch { /* not executable */ }
  // Only an explicit stamp is evidence of a build SHA; a nearby checkout HEAD
  // would not establish which source produced an installed executable.
  let root = dirname(entry.realpath)
  for (let depth = 0; depth < 6; depth++) {
    const raw = readable(join(root, 'foundation-install.json'))
    if (raw) {
      try {
        const value: unknown = JSON.parse(raw)
        if (value && typeof value === 'object' && 'runtime' in value
            && value.runtime && typeof value.runtime === 'object') {
          entry.stampPath = join(root, 'foundation-install.json')
          const runtime = value.runtime
          if ('packageVersion' in runtime && typeof runtime.packageVersion === 'string') entry.packageVersion = runtime.packageVersion
          if ('dirty' in runtime && typeof runtime.dirty === 'boolean') entry.dirty = runtime.dirty
          if ('sessionProtocols' in runtime && Array.isArray(runtime.sessionProtocols) && runtime.sessionProtocols.every((v: unknown) => typeof v === 'string')) entry.sessionProtocols = runtime.sessionProtocols
          if ('chainFormats' in runtime && Array.isArray(runtime.chainFormats) && runtime.chainFormats.every((v: unknown) => v === 1 || v === 2)) entry.chainFormats = runtime.chainFormats
          if ('defaultChainFormat' in runtime && (runtime.defaultChainFormat === 1 || runtime.defaultChainFormat === 2)) entry.defaultChainFormat = runtime.defaultChainFormat
          if ('documentFormats' in runtime && Array.isArray(runtime.documentFormats) && runtime.documentFormats.every((v: unknown) => typeof v === 'string')) entry.documentFormats = runtime.documentFormats
          if ('sourceSha' in runtime && typeof runtime.sourceSha === 'string'
              && /^[a-f0-9]{40,64}$/i.test(runtime.sourceSha)) entry.sourceSha = runtime.sourceSha
          if ('artboardWriteSafe' in runtime && typeof runtime.artboardWriteSafe === 'boolean') {
            entry.artboardWriteSafe = runtime.artboardWriteSafe
          }
        }
      } catch { /* unknown stamp format */ }
      break
    }
    const parent = dirname(root)
    if (parent === root) break
    root = parent
  }
  return entry
}
