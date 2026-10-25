import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, closeSync, fsyncSync, lstatSync, openSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { sourceRoot } from '../runtime-version.js'
import { acquireDocumentLock } from '../document-lock.js'

/** Compile once per helper source revision. Secrets never enter compiler input or argv. */
function helper(): string {
  const source = join(sourceRoot, 'packages/cli/src/share/keychain-helper.swift')
  const digest = createHash('sha256').update(readFileSync(source)).digest('hex')
  const parent = join(homedir(), '.foundation', 'share')
  const directory = join(parent, 'helpers')
  for (const path of [parent, directory]) {
    mkdirSync(path, { recursive: true, mode: 0o700 })
    const info = lstatSync(path)
    if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077 || info.uid !== process.getuid?.())
      throw new Error('share helper directory must be private (0700)')
  }
  const cache = join(directory, `keychain-${digest}`)
  const binary = join(cache, 'helper')
  const valid = (): boolean => {
    let cacheInfo
    try { cacheInfo = lstatSync(cache) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
    for (const [path, kind] of [[cache, 'directory'], [binary, 'binary'], [join(cache, 'manifest.json'), 'manifest']] as const) {
      const info = path === cache ? cacheInfo : lstatSync(path)
      if (info.isSymbolicLink() || info.mode & 0o077 || info.uid !== process.getuid?.() ||
          (kind === 'directory' ? !info.isDirectory() : !info.isFile()) || (kind === 'binary' && !(info.mode & 0o100)))
        throw new Error('share Keychain helper cache must be private and owned by the current user')
    }
    const expected = JSON.parse(readFileSync(join(cache, 'manifest.json'), 'utf8')) as { source: string; binary: string }
    if (expected.source !== digest || expected.binary !== createHash('sha256').update(readFileSync(binary)).digest('hex'))
      throw new Error('share Keychain helper hash mismatch')
    return true
  }
  if (valid()) return binary
  const release = acquireDocumentLock(cache, 65000)
  const temporary = join(directory, `.keychain-${randomUUID()}.tmp`)
  try {
    if (!valid()) {
      mkdirSync(temporary, { mode: 0o700 })
      try {
        const output = join(temporary, 'helper')
        execFileSync('/usr/bin/xcrun', ['swiftc', '-O', '-module-name', 'FoundationShareKeychain', source, '-o', output], {
          timeout: 60000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
        })
        chmodSync(output, 0o700)
        const binaryHash = createHash('sha256').update(readFileSync(output)).digest('hex')
        writeFileSync(join(temporary, 'manifest.json'), JSON.stringify({ source: digest, binary: binaryHash }), { mode: 0o600, flag: 'wx' })
        renameSync(temporary, cache)
      } catch { throw new Error('cannot build macOS Keychain helper; install Xcode Command Line Tools') }
    }
    return binary
  } finally {
    rmSync(temporary, { recursive: true, force: true })
    release()
  }
}
function scope(keychain?: string): string {
  return join(homedir(), '.foundation', 'share', `native-keychain-${createHash('sha256').update(keychain ?? 'default').digest('hex')}`)
}
function observed(keychain?: string): boolean {
  try {
    const info = lstatSync(scope(keychain) + '.json')
    if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077 || info.uid !== process.getuid?.())
      throw new Error('native Keychain migration marker must be private')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
function markObserved(keychain?: string): void {
  if (observed(keychain)) return
  try {
    const fd = openSync(scope(keychain) + '.json', 'wx', 0o600)
    try { writeFileSync(fd, '{"nativeSeen":true}\n'); fsyncSync(fd) } finally { closeSync(fd) }
    const parent = openSync(join(homedir(), '.foundation', 'share'), 'r')
    try { fsyncSync(parent) } finally { closeSync(parent) }
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !observed(keychain)) throw error }
}
function getNative(binary: string, keychain?: string): string | undefined {
  try {
    const text = execFileSync(binary, ['get', homedir(), ...(keychain ? [keychain] : [])], {
      encoding: 'utf8', timeout: 10000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
    })
    markObserved(keychain)
    return text
  } catch (error) {
    if ((error as { status?: number }).status === 44) return undefined
    throw new Error('cannot read Foundation sharing keys from Keychain')
  }
}
function setNative(binary: string, text: string, keychain?: string): void {
  try {
    execFileSync(binary, ['set', homedir(), ...(keychain ? [keychain] : [])], {
      input: text, timeout: 10000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']
    })
    markObserved(keychain)
  } catch { throw new Error('cannot write Foundation sharing keys to Keychain') }
}
export function readKeychain(keychain?: string): string | undefined {
  const binary = helper()
  const current = getNative(binary, keychain)
  if (current !== undefined) return current
  const release = acquireDocumentLock(scope(keychain), 15000)
  try {
    // Another process may have migrated or created the native item while we waited.
    const latest = getNative(binary, keychain)
    if (latest !== undefined) return latest
    if (observed(keychain)) throw new Error('native share Keychain item missing after migration; restore the Keychain or use recovery')
    let legacy: string
    try {
      legacy = execFileSync('/usr/bin/security', ['find-generic-password', '-a', homedir(), '-s', 'foundation-share-v1', '-w', ...(keychain ? [keychain] : [])], {
        encoding: 'utf8', timeout: 10000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      if ((error as { status?: number }).status === 44) return undefined
      throw new Error('cannot read legacy Foundation sharing keys for migration')
    }
    // One-way copy only on first use; the durable marker prevents stale resurrection.
    try { JSON.parse(legacy) } catch { throw new Error('invalid legacy Foundation sharing vault') }
    setNative(binary, legacy, keychain)
    const verified = getNative(binary, keychain)
    if (verified !== legacy) throw new Error('Foundation sharing Keychain migration verification failed')
    return verified
  } finally { release() }
}
export function writeKeychain(text: string, keychain?: string): void {
  const binary = helper()
  const release = acquireDocumentLock(scope(keychain), 15000)
  try { setNative(binary, text, keychain) } finally { release() }
}
