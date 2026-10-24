import { appendFileSync } from 'node:fs'
import { hostname } from 'node:os'

/** Opt-in profiling only: never logs document content, paths, credentials or RPC payloads. */
export const syncTraceEnabled = Boolean(process.env.FOUNDATION_SYNC_TRACE)
const file = process.env.FOUNDATION_SYNC_TRACE
let warned = false
export function syncTrace(stage: string, fields: () => Record<string, unknown> = () => ({})): void {
  if (!file) return
  try {
    appendFileSync(file, JSON.stringify({ v: 1, stage, pid: process.pid, node: process.env.FOUNDATION_NODE_ID ?? hostname(), wallMs: Date.now(), monoNs: process.hrtime.bigint().toString(), ...fields() }) + '\n', { mode: 0o600 })
  } catch {
    if (!warned) { warned = true; process.stderr.write('Foundation sync trace unavailable; editing continues\n') }
  }
}
export function syncTraceSpan(stage: string, fields: () => Record<string, unknown> = () => ({})): (extra?: Record<string, unknown>) => void {
  if (!file) return () => {}
  const started = process.hrtime.bigint(), values = fields()
  syncTrace(`${stage}.start`, () => values)
  return (extra = {}) => syncTrace(`${stage}.end`, () => ({ ...values, durationMs: Number(process.hrtime.bigint() - started) / 1e6, ...extra }))
}
