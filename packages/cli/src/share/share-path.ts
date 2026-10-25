import { mkdirSync, lstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/** State isolation never changes the OS account or the default Keychain identity. */
export function shareStateDir(): string {
  const dir = process.env.FOUNDATION_SHARE_STATE_DIR ?? join(homedir(), '.foundation', 'share')
  if (!isAbsolute(dir)) throw new Error('FOUNDATION_SHARE_STATE_DIR must be absolute')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const stat = lstatSync(dir)
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.mode & 0o077) throw new Error('share key directory must be private (0700)')
  return dir
}
