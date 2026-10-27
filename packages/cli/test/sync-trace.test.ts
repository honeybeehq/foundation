import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
let dir: string | undefined
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); if (dir) rmSync(dir, { recursive: true, force: true }) })
it('writes opt-in monotonic spans without adding user data', async () => {
  dir = mkdtempSync(join(tmpdir(), 'sync-trace-')); const file = join(dir, 'trace.jsonl')
  vi.stubEnv('FOUNDATION_SYNC_TRACE', file); vi.resetModules()
  const { syncTraceSpan } = await import('../src/sync-trace.js')
  const done = syncTraceSpan('rpc.read', () => ({ docId: 'test', cursor: '1' })); done({ ok: true })
  const rows = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  expect(rows.map(row => row.stage)).toEqual(['rpc.read.start', 'rpc.read.end'])
  expect(rows[1].durationMs).toBeGreaterThanOrEqual(0); expect(BigInt(rows[1].monoNs)).toBeGreaterThanOrEqual(BigInt(rows[0].monoNs))
})
it('does not evaluate data suppliers when tracing is off', async () => {
  vi.stubEnv('FOUNDATION_SYNC_TRACE', ''); vi.resetModules()
  const { syncTrace, syncTraceSpan } = await import('../src/sync-trace.js')
  const supply = vi.fn(() => ({ secret: 'must-not-run' }))
  syncTrace('off', supply); syncTraceSpan('off', supply)(); expect(supply).not.toHaveBeenCalled()
})
