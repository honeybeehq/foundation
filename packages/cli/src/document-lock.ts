import { randomUUID } from 'node:crypto'
import { closeSync, openSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { currentLockOwner, staleLockOwner, type LockOwner } from './lock-owner.js'

const held = new Set<string>()
const sleeper = new Int32Array(new SharedArrayBuffer(4))

export class DocumentBusyError extends Error {
  constructor(file: string, path: string) {
    let owner = 'unreadable owner'
    try { owner = readFileSync(path, 'utf8') } catch { /* The owner may have just released. */ }
    const quoted = "'" + path.replaceAll("'", "'\\''") + "'"
    super(`document is busy: ${file}; lock ${path}; recorded owner: ${owner}. Retry the edit. Only after confirming the owner is stopped, remove the stale lock: rm -- ${quoted}`)
  }
}

function lockPath(file: string): string {
  try {
    return `${realpathSync(file)}.lock`
  } catch {
    return join(realpathSync(dirname(resolve(file))), `${basename(file)}.lock`)
  }
}

export function documentPath(file: string): string {
  try { return realpathSync(file) } catch { return resolve(file) }
}

function reapLock(path: string, local: LockOwner): void {
  const guard = `${path}.reap`
  let fd: number
  try { fd = openSync(guard, 'wx') } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      try {
        if (Date.now() - statSync(guard).mtimeMs > 30000) unlinkSync(guard)
      } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err }
      return
    }
    throw err
  }
  try {
    closeSync(fd)
    const source = readFileSync(path, 'utf8')
    let stale = false
    try {
      stale = staleLockOwner(JSON.parse(source) as Partial<LockOwner>, local)
    } catch {
      stale = Date.now() - statSync(path).mtimeMs > 30000
    }
    if (stale) unlinkSync(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  } finally { unlinkSync(guard) }
}

export function acquireDocumentLock(file: string, timeoutMs = 5000): () => void {
  const path = lockPath(file)
  if (held.has(path)) throw new DocumentBusyError(file, path)
  const local = currentLockOwner()
  const owner = JSON.stringify({ ...local, created: new Date().toISOString(), token: randomUUID() })
  const deadline = performance.now() + timeoutMs
  for (;;) {
    try {
      const fd = openSync(path, 'wx')
      try {
        writeFileSync(fd, owner)
      } finally {
        closeSync(fd)
      }
      held.add(path)
      return () => {
        held.delete(path)
        if (readFileSync(path, 'utf8') === owner) unlinkSync(path)
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
    reapLock(path, local)
    if (performance.now() >= deadline) throw new DocumentBusyError(file, path)
    Atomics.wait(sleeper, 0, 0, 5)
  }
}

export function isDocumentLocked(file: string): boolean {
  return held.has(lockPath(file))
}

export function withDocumentLock<T>(file: string, run: () => T, timeoutMs?: number): T {
  const release = acquireDocumentLock(file, timeoutMs)
  try {
    return run()
  } finally {
    release()
  }
}
