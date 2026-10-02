import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

export function readBytesIfPresent(path: string): Uint8Array | null {
  try {
    return readFileSync(path)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

export function readTextIfPresent(path: string): string | null {
  const bytes = readBytesIfPresent(path)
  return bytes === null ? null : new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null || b === null) return a === b
  return Buffer.compare(a, b) === 0
}

export function writeAtomic(path: string, data: string | Uint8Array): void {
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`)
  try {
    writeFileSync(temp, data)
    renameSync(temp, path)
  } catch (err) {
    rmSync(temp, { force: true })
    throw err
  }
}
