import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { liveDesigns } from './sync-store.js'

export function defaultChainFormat(): 1 | 2 {
  const value = process.env.FOUNDATION_CHAIN_FORMAT
  if (value !== undefined && value !== '1' && value !== '2') throw new Error('FOUNDATION_CHAIN_FORMAT must be 1 or 2')
  return value === '2' ? 2 : 1
}

export function syncEnabledFor(file: string): boolean {
  if (process.env.FOUNDATION_SYNC_AUTO_OPEN === '1') return true
  let path = resolve(file)
  try { path = realpathSync(path) } catch { /* A new document has no path yet. */ }
  try { return liveDesigns().some(design => design.file === path) } catch { return false }
}

export function selectedChainFormat(file: string, current: 1 | 2 = 1): 1 | 2 {
  const configured = defaultChainFormat()
  return current === 2 || configured === 2 || syncEnabledFor(file) ? 2 : 1
}

export function chainFormatUpgradeWarning(file: string): string {
  return `${file}: upgraded to chain format 2; older Foundation builds cannot read this file. Upgrade those readers before sharing it.`
}
