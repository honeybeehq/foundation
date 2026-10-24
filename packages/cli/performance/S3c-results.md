# Two-machine sync latency

Saved changes become visible in the other session within the requested latency targets.
This does not measure when Comb confirms durable sharing.

| Direction | Direct off median | Direct on median | Direct off empirical p95 | Direct on empirical p95 |
|---|---:|---:|---:|---:|
| Studio → metal-3 | 1,619 ms | **434 ms** | 1,756 ms | **593 ms** |
| metal-3 → Studio | 913 ms | **568 ms** | 1,076 ms | **918 ms** |

These are conservative upper bounds, including measured clock uncertainty and a
2 ms timestamp-resolution guard. The guard is not a clock-synchronization claim:
seven RTT clock brackets before and seven after give a final observed B−A
offset envelope[−9.729,+66.215]ms (union, not intersection). Each sample uses
the conservative end of that envelope before adding the guard. This assumes
offset stayed inside that observed envelope; arbitrary unobserved clock steps
inside the run are not bounded by before/after calibration. Targets: median ≤1,000 ms and p95 ≤1,500 ms.
Twenty measured saves per direction follow three declared warmups.
The empirical p95 is the nearest-rank19th value of 20 (second-highest), not a
population-level tail estimate. Every measured
save succeeded; both hosts ended with identical HTML and chain bytes. No measured
samples were dropped. Two earlier failed baseline startup warmups remain in the
raw input; the stale-host singleton-lock bug was fixed separately in S1d.

The on/off series use the SAME runtime 30bea85f5634b20d4e7bf552e40e4809eccac3a6,
one live copy per host, and the same byte-identical 61-change fixture reset before
each series, finishing with107 changes. Each series has3 warmups plus20 measured
saves per direction; all 80 measured saves succeeded. Hosts, temporary SeaweedFS4.49
backend, traced S3 proxy19344 and real-session collector stayed constant. Studio
used Node24.20.0; metal-3 used Node24.18.0. Workspace names isolate logs. Foundation
stage tracing was off for both timing series; proxy service spans remained on.
These are sequential feature/control windows, not randomized interleaved trials.
No population-level confidence interval or speedup ratio is claimed.

The direct-on clock envelope is[−9.729,+66.215]ms; off is[+1.040,+70.479]ms.
Both use all retained before/after RTT brackets plus the 2ms quantization guard.
An earlier pre-feature timing reference at a1cb806 is retained as historical
context in S3c-baseline*.json, including failed startup warmups; it is not the
same-build control in the table above. The exact measured source includes S1d.
Later local changes harden tests, record evidence and clarify documentation;
CLI/engine runtime source matches the measured 30bea85 build.

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
bounds at the medians are 0–44ms and 12–91ms respectively; they include uncertainty.
Proxy service times are mostly single-digit milliseconds, but its whitelisted
trace lacks client/log identity, so concurrent catalogue requests cannot be
assigned exact per-append request counts. No storage-semantic change is claimed.

## Durability and failure contract

Direct requests are workspace-authenticated, bounded and optional. Unknown peers,
foreign history and missing parents are rejected before a new frontier is saved.
A failed listener leaves Comb sync running. Direct-received changes are not
re-forwarded during the same daemon run; durable publication pauses before a held parent, then resumes when
Comb confirms it or randomized 5–10s grace expires. Restart deliberately expires in-memory grace and can reannounce pending history
once. An echo may delay its original author’s upload once by up to10s; causal
descendants then wait too. This bounded restart cost does not lose history. Full native causal order is used, not just envelope prevHash.

The corrected burst profile observed source save→Comb acknowledgement at
1,820/2,862/3,483/7,604/8,743ms for Studio and 1,795/2,760/6,784/7,529ms for
metal-3; the fifth metal-3 acknowledgement lies outside the packaged trace window
and is right-censored. These are source append receipts, not receiver-status
sharing times. Durable causal-prefix publication and lease contention can queue
while direct visibility remains fast. Two-machine outcomes (`S3c-outcomes.json`) cover the drill; S5 is tightening the
true simultaneous-conflict chapter before its final reseal. The visibility and
direct-off datasets are independent of that chapter.
During whole-store outage, local edits saved and peer copies converged while
status correctly remained waiting for upload. A strict one-node storage outage
with peers disabled kept the healthy node working and the denied node waiting;
restoring access merged the edits exactly. Empty metal-3 recovery through the
normal CLI took 1,424ms with exact HTML/chain bytes, and a separate durable-only
replica then edited in both directions without direct delivery. Undo/conflict and
supported Git pull/divergent merge checks passed, with clean final Git state.

Clean async-observer cold-store recovery reached shared on both nodes within
19.164s of the store-start REQUEST. Retained samples show 2 pending per node;
this includes unknown cold-storage readiness, retries and publication time, not
just Foundation work after a known-ready backend. Cause is currently unknown;
no worst-case recovery bound is claimed. The earlier~22s observation had 12 pending
and was contaminated by synchronous observer work; it remains on record.
The orchestrator accepted attribution as a follow-up for this batch.

A fresh materialize attempt initially timed out after 35s before any file write:
the harness synchronously spawned the CLI while its same process served the
child's S3 proxy requests. Standalone cold-head requests took 25–29ms; AWS env was
identical. Async harness spawning fixed the self-deadlock with no product binary,
Comb or timeout change. The ordinary empty-target retry passed; no data seed or
source edit was repeated to hide a failure. Two earlier startup warmups and the
third-replica equal-old observer assertion remain explicitly retained.

Direction asymmetry persists: Studio-origin visibility is faster in direct mode;
metal-3-origin is faster through storage alone. The full cause is unmeasured,
not dismissed as noise.

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

Attention: reviewed by claude-opus-5-5 (source and result framing only; no independent
runtime execution by that reviewer). Cold durable-drain attribution remains a
follow-up accepted by the orchestrator. The true simultaneous-conflict chapter
belongs to the separately resealed S5 proof, not this latency claim.
