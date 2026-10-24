import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { linkSync, mkdirSync, readFileSync, readlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'

export interface LockOwner { pid: number; host: string; machineId: string; bootId: string | null; pidNamespace: string | null }
function read(path: string): string | null { try { return readFileSync(path, 'utf8').trim() || null } catch { return null } }
function command(binary: string, args: string[]): string | null {
  try { return execFileSync(binary, args, { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null } catch { return null }
}
function machineId(): string {
  if (process.env.FOUNDATION_NODE_ID) return `explicit:${process.env.FOUNDATION_NODE_ID}`
  const osId = process.platform === 'linux' ? read('/etc/machine-id') ?? read('/var/lib/dbus/machine-id')
    : process.platform === 'darwin' ? command('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])?.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1] : null
  if (osId) return `os:${createHash('sha256').update(osId).digest('hex')}`
  // A fallback identity is published atomically; never expose an empty first-write file.
  const dir = join(homedir(), '.foundation'); mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, 'machine-id'), existing = read(path)
  if (existing) return `fallback:${existing}`
  const temp = `${path}.${randomUUID()}`
  writeFileSync(temp, randomUUID(), { flag: 'wx', mode: 0o600 })
  try { linkSync(temp, path) } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err } finally { unlinkSync(temp) }
  const id = read(path)
  if (!id) throw new Error(`invalid machine identity: ${path}`)
  return `fallback:${id}`
}
export function currentLockOwner(): LockOwner {
  let pidNamespace: string | null = null
  if (process.platform === 'linux') { try { pidNamespace = readlinkSync('/proc/self/ns/pid') } catch { /* Unavailable: require matching null. */ } }
  return { pid: process.pid, host: hostname(), machineId: machineId(),
    bootId: process.platform === 'linux' ? read('/proc/sys/kernel/random/boot_id') : process.platform === 'darwin' ? command('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid']) : null,
    pidNamespace }
}
export function staleLockOwner(owner: Partial<LockOwner>, local: LockOwner): boolean {
  if (!Number.isSafeInteger(owner.pid) || (owner.pid ?? 0) <= 0) return false
  if (owner.machineId !== undefined) {
    if (owner.machineId !== local.machineId || (owner.pidNamespace ?? null) !== local.pidNamespace) return false
    // Fallback home ids can be shared across hosts; never trust them across a rename.
    if (local.machineId.startsWith('fallback:') && (owner.host !== local.host || !owner.bootId || owner.bootId !== local.bootId)) return false
    if (owner.bootId && local.bootId && owner.bootId !== local.bootId) return true
  } else if (owner.host !== local.host) return false
  try { process.kill(owner.pid!, 0); return false } catch (err) { return (err as NodeJS.ErrnoException).code === 'ESRCH' }
}
