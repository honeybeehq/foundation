#!/usr/bin/env node
// Analysis only: consumes the S5 real-session driver output; never edits a design.
import { readFileSync, writeFileSync } from 'node:fs'
const [input, output, seriesId, commit] = process.argv.slice(2)
if (!input || !output || !seriesId || !commit) throw new Error('usage: sync-latency-receipt.mjs INPUT OUTPUT SERIES_ID COMMIT')
const data = JSON.parse(readFileSync(input, 'utf8'))
const { lo, hi } = data.offsetIntersection ?? {}
if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) throw new Error('missing or contradictory cross-host clock brackets')
const brackets = [...data.clockBefore, ...data.clockAfter]
const computedLo = Math.max(...brackets.map(b => b.remote - b.t2))
const computedHi = Math.min(...brackets.map(b => b.remote - b.t1))
if (Math.abs(lo - computedLo) > 0.01 || Math.abs(hi - computedHi) > 0.01) throw new Error('offset intersection disagrees with retained RTT brackets')
const envelopeLo = Math.min(...brackets.map(b => b.remote - b.t2))
const envelopeHi = Math.max(...brackets.map(b => b.remote - b.t1))
const rows = data.rows.filter(row => !row.warmup)
const results = []
for (const [writer, direction] of [['a', 'studioToMetal'], ['b', 'metalToStudio']]) {
  const selected = rows.filter(row => row.writer === writer)
  const upperBounds = []
  for (const row of selected) {
    if (!row.ok) continue // Retain failures and fail the invariant; never invent a latency.
    if (!Number.isFinite(row.savedMtime) || !Number.isFinite(row.receivedAt)) throw new Error('missing observed timestamps')
    const raw = row.receivedAt - row.savedMtime
    const interval = writer === 'a' ? [raw - hi, raw - lo] : [raw + lo, raw + hi]
    if (!Array.isArray(row.latencyIntervalMs) || interval.some((n, i) => Math.abs(n - row.latencyIntervalMs[i]) > 0.01)) throw new Error('reported bounds disagree with clock brackets')
    const conservativeUpper = writer === 'a' ? raw - envelopeLo : raw + envelopeHi
    upperBounds.push(conservativeUpper + 2) // Guard integer-millisecond event/clock quantization.
  }
  for (const percentile of ['P50', 'P95']) results.push({ metric: `${direction}saveToSession${percentile}`, samples: upperBounds, invariantHolds: selected.length >= 20 && selected.every(row => row.ok && /^[a-f0-9]{64}$/.test(row.head)) && new Set(selected.map(row => row.head)).size === selected.length, observations: selected.length, failed: selected.filter(row => !row.ok).length })
}
writeFileSync(output, JSON.stringify({ workload: 'sync-save-to-session', seriesId, commit, source: input, clockOffsetIntersectionMs: { lo, hi }, observedClockOffsetEnvelopeMs: { lo: envelopeLo, hi: envelopeHi }, clockAssumption: 'offset stays inside union of retained before/after RTT brackets; unobserved interior clock steps are not bounded', timestampResolutionGuardMs: 2, results, warmups: data.rows.filter(row => row.warmup), startupFailures: data.startupFailures ?? [], convergence: data.after }, null, 2) + '\n')
