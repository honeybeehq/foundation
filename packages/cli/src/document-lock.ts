import { randomUUID } from 'node:crypto'
import { closeSync, openSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { hostname } from 'node:os'

const held = new Set<string>()
const sleeper = new Int32Array(new SharedArrayBuffer(4))

export class DocumentBusyError extends Error {
  constructor(file: string) { super(`document is busy: ${file}; retry the edit`) }
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

function reapLock(path: string): void {
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
      const owner = JSON.parse(source) as { pid?: unknown; host?: unknown }
      if (owner.host === hostname() && typeof owner.pid === 'number' && Number.isInteger(owner.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0) } catch (err) { stale = (err as NodeJS.ErrnoException).code === 'ESRCH' }
      }
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
  if (held.has(path)) throw new DocumentBusyError(file)
  const owner = JSON.stringify({ pid: process.pid, host: hostname(), created: new Date().toISOString(), token: randomUUID() })
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
    reapLock(path)
    if (performance.now() >= deadline) throw new DocumentBusyError(file)
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
