import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireDocumentLock } from '../src/document-lock.js'
import { currentLockOwner, staleLockOwner } from '../src/lock-owner.js'

const dead = 2147483647
const local = currentLockOwner()
describe('lock owner identity', () => {
  it('survives hostname changes and preserves live owners', () => {
    expect(staleLockOwner({ ...local, host: 'old-host', pid: dead }, local)).toBe(true)
    expect(staleLockOwner({ ...local, host: 'old-host' }, local)).toBe(false)
  })
  it('never probes foreign machines or PID namespaces', () => {
    expect(staleLockOwner({ ...local, machineId: 'foreign', pid: dead }, local)).toBe(false)
    expect(staleLockOwner({ ...local, pidNamespace: 'foreign', pid: dead }, local)).toBe(false)
  })
  it('reaps a previous boot even when its pid has been reused', () => {
    expect(staleLockOwner({ ...local, bootId: 'previous-boot' }, { ...local, bootId: 'current-boot' })).toBe(true)
  })
  it('only reaps dead legacy owners on the same hostname', () => {
    expect(staleLockOwner({ host: local.host, pid: dead }, local)).toBe(true)
    expect(staleLockOwner({ host: 'old-host', pid: dead }, local)).toBe(false)
    expect(staleLockOwner({ host: local.host, pid: process.pid }, local)).toBe(false)
  })
  it('does not trust a shared fallback across host or boot changes', () => {
    const fallback = { ...local, machineId: 'fallback:shared', bootId: 'boot-a' }
    expect(staleLockOwner({ ...fallback, host: 'other', pid: dead }, fallback)).toBe(false)
    expect(staleLockOwner({ ...fallback, bootId: 'boot-b', pid: dead }, fallback)).toBe(false)
    expect(staleLockOwner({ ...fallback, pid: dead }, fallback)).toBe(true)
  })
  it('explains manual recovery for foreign legacy owners', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'fdn-lock-')), 'document')
    writeFileSync(`${file}.lock`, JSON.stringify({ host: 'foreign-host', pid: dead, created: '2026-01-01' }))
    expect(() => acquireDocumentLock(file, 5)).toThrow(/foreign-host.*2147483647.*rm --/)
  })
  it('reaps through the real lock acquisition and records stable ownership', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'fdn-lock-')), 'document')
    writeFileSync(`${file}.lock`, JSON.stringify({ ...local, host: 'old-host', pid: dead }))
    const release = acquireDocumentLock(file, 50)
    expect(JSON.parse(readFileSync(`${file}.lock`, 'utf8'))).toMatchObject({ machineId: local.machineId, bootId: local.bootId, pidNamespace: local.pidNamespace })
    expect(() => acquireDocumentLock(file, 10)).toThrow('busy')
    release()
  })
})
