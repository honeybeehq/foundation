# Two-machine sync latency

Saved changes become visible in the other session within the requested latency targets.
This does not measure when Comb confirms durable sharing.

| Direction | Earlier reference median | Direct median | Earlier reference empirical p95 | Direct empirical p95 |
|---|---:|---:|---:|---:|
| Studio → metal-3 | 1,648 ms | **431 ms** | 1,833 ms | **590 ms** |
| metal-3 → Studio | 1,033 ms | **555 ms** | 1,770 ms | **905 ms** |

These are conservative upper bounds, including measured clock uncertainty and a
2 ms timestamp-resolution guard. The guard is not a clock-synchronization claim:
seven RTT clock brackets before and seven after bound the final B−A offset to
[−6.287,+53.437]ms. Every sample uses the conservative end of that interval
before adding the guard. Targets: median ≤1,000 ms and p95 ≤1,500 ms.
Twenty measured saves per direction follow three declared warmups.
The empirical p95 is the nearest-rank19th value of 20 (second-highest), not a
population-level tail estimate. Every measured
save succeeded; both hosts ended with identical HTML and chain bytes. No measured
samples were dropped. Two earlier failed baseline startup warmups remain in the
raw input; the stale-host singleton-lock bug was fixed separately in S1d.

The earlier reference and direct series start from the same byte-identical 61-change
fixture and finish with107 changes. The reference uses a different commit but also one live copy per node, confirmed
from the retained registry. A same-build direct-off control is pending.
No improvement ratio or matched before/after causal estimate is claimed yet. Hosts, temporary SeaweedFS4.49 backend, traced S3 proxy19344 and real-session
collector stayed constant. Each direct-run host had one live copy in a fresh
replica store. Workspace names differ to isolate logs. Foundation stage tracing
was disabled for both timing series; proxy service spans remained enabled.

Baseline runtime: a1cb80613f1ea85cfa8b18d023d9bda8bdd5ad7f.
Direct runtime: 30bea85f5634b20d4e7bf552e40e4809eccac3a6, including S1d.
Later local changes harden tests, record this evidence and clarify the spec;
CLI/engine runtime source matches the measured direct runtime.

## Why the path became faster

The supported storage append remains durable and unchanged. Direct verified
change delivery proceeds alongside it, rather than waiting for its many storage
round trips. All later Comb deliveries deduplicate by the same envelope hash.
The node-local chain is still saved first, and direct receipts never mark shared.

The following stage medians come from separate five-save-per-direction profiles.
The baseline profile has 49→59changes; the corrected direct profile 61→71. These
are attribution observations, not a matched timing comparison. Do not add medians.
Both profiles have one live copy per host. Repeated baseline import spans can
represent echoed deliveries, not extra copies; registry evidence confirms the
population. New-hash and duplicate imports are distinguished in the raw trace.

| Stage | Baseline Studio-origin | Direct Studio-origin | Baseline metal-3-origin | Direct metal-3-origin |
|---|---:|---:|---:|---:|
| Save → source notice |159 ms|56 ms|53 ms|58 ms|
| Save → storage append start, incl. spawn/hello |182 ms|parallel|126 ms|parallel|
| Storage append RPC |1,037 ms|off live path|212 ms|off live path|
| Bounded target read |31 ms|off live path|207 ms|off live path|
| Target locked import, including strict verify |124 ms|135 ms|67 ms|73 ms|
| Strict verify within import |20 ms|included, not separately timed|8 ms|included, not separately timed|
| Import → session event |156 ms|155 ms|286 ms|200 ms|

Corrected profile: all 10 target chain writes fall inside successful direct receive
spans. Comb imports in that window all report imported=0. Thus direct-first hit
rate is 10/10 in the profiled population. The untraced 40-save run does not carry
route traces; no hit-rate claim is made for it. Source notice→receive-start clock
bounds at the medians are 0–36ms and 20–81ms respectively; they include uncertainty.
Proxy service times are mostly single-digit milliseconds, but its whitelisted
trace lacks client/log identity, so concurrent catalogue requests cannot be
assigned exact per-append request counts. No storage-semantic change is claimed.

## Durability and failure contract

Direct requests are workspace-authenticated, bounded and optional. Unknown peers,
foreign history and missing parents are rejected before a new frontier is saved.
A failed listener leaves Comb sync running. Direct-received changes are never
re-forwarded; durable publication pauses before a held parent, then resumes when
Comb confirms it or randomized 5–10s grace expires. Restart deliberately expires
in-memory grace. Full native causal order is used, not just envelope prevHash.

The corrected burst profile observed source save→Comb acknowledgement at
1,820/2,862/3,483/7,604/8,743ms for Studio and 1,795/2,760/6,784/7,529ms for
metal-3; the fifth metal-3 acknowledgement lies outside the packaged trace window
and is right-censored. These are source append receipts, not receiver-status
sharing times. Durable causal-prefix publication and lease contention can queue
while direct visibility remains fast. Receiver shared-status timing and final
two-machine outage/direct-loss checks are pending S5’s final chapter.

Direction asymmetry persists: Studio-origin visibility is faster than metal-3
origin in the final series. Its full cause is unmeasured, not dismissed as noise.

## Recheck

```
node packages/cli/scripts/perf-map.mjs check packages/cli/performance/S3c-direct.json
```

Expected: pass for all four metrics. Regeneration commands and raw input are in
README.md. A deliberately worsened receipt adding 2,000ms to every sample fails
all four metrics. This validates the assessor, not a second measured run.

Evidence sources: research/S5-baseline-results.json,
research/S5-direct-steady-results.json, research/S5-fixed-trace-studio.json,
research/S5-metal3-corrected-trace.json, and the compact JSON files beside this
report. No secrets or remote absolute paths are required to repeat the analysis.

Unmeasured limits: 32 concurrent authenticated inbound verifications share the
daemon event loop; unsolicited tailnet connections can exhaust the optional
listener; diagnostic status can be stale after PID reuse; history scans and
catalogue retention remain unbounded. Explicit peer setup and workspace secrets
are required. The shared key proves membership, not author identity.
