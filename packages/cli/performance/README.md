# Sync latency receipts

`S3c-baseline-samples.json` retains all 40 steady-state observations, six
warmups and two separately labelled failed startup warmups from the real
Studio/metal-3 session driver. Foundation stage tracing was off; the same
proxy service-span logging remained on throughout. Initial fixture: 61 changes;
final: 107. `after.hashes` is [HTML checksum, chain checksum]; both hosts matched.

Regenerate conservative upper-bound timing receipts:

```
node packages/cli/scripts/sync-latency-receipt.mjs packages/cli/performance/S3c-baseline-samples.json packages/cli/performance/S3c-baseline.json studio-metal3-frontier61-proxy19344-v1 a1cb80613f1ea85cfa8b18d023d9bda8bdd5ad7f
node packages/cli/scripts/perf-map.mjs check packages/cli/performance/S3c-baseline.json
```

The baseline correctly fails all four ruled latency budgets. The collector
recomputes intervals from observed timestamps and before/after clock brackets;
it rejects contradictory reported intervals and inconsistent retained RTT brackets.
Acceptance then uses the union of all before/after brackets instead of the
constant-offset intersection, assuming skew stays within that observed envelope.
A two-millisecond guard covers integer-millisecond event/clock quantization. It retains failures without
inventing their latency. Startup failures remain in the receipt and are not
mixed into steady-state percentiles.

`S3c-profile-stages.json` is attribution only (five profiled saves per direction,
history 49–59). Columns use each host's own span clock; total intervals use
cross-host clock bounds. Never sum independent medians or use this small profile
as a p95 acceptance run. Raw traces and host metadata are in Project files
`research/S5-studio-trace.json`, `research/S5-metal3-trace.json`,
`research/S5-metal3-baseline-host.json`. Credentials are excluded.

The matched direct-on series is `S3c-direct-samples.json`, exact runtime
30bea85f5634b20d4e7bf552e40e4809eccac3a6. Reset restored the exact same 61-change
fixture before the three warmups plus twenty saves per direction. Each node had
one live copy in its own replica store. Different workspace names isolate feeds;
backend, endpoint, hosts, collector and initial design bytes stayed constant.
Foundation tracing remained off for timing. Runtime includes the unrelated S1d
singleton-lock identity fix; it does not change the measured edit/save hot path.

```
node packages/cli/scripts/sync-latency-receipt.mjs packages/cli/performance/S3c-direct-samples.json packages/cli/performance/S3c-direct.json studio-metal3-frontier61-proxy19344-v1 30bea85f5634b20d4e7bf552e40e4809eccac3a6
node packages/cli/scripts/perf-map.mjs check packages/cli/performance/S3c-direct.json
```

All four targets pass. The deliberately worsened oracle check adds2000ms to
every retained sample; all four results fail. This is a fault-injection check of
the assessor, not a performance observation.

The corrected direct profile is `S3c-direct-profile-stages.json` (five saves per
direction, one live copy per host, same runtime). Each target chain write occurs
inside a successful direct receive span; later Comb imports report imported=0.
This proves a10/10 direct-first rate for the traced sample population. The separate
untraced40-save timing population carries no route trace, so its hit rate is not
claimed. Source and target clock uncertainty can leave a negative lower network
bound; the retained bound intersects that interval with nonnegative physical time.
Full verification is included in the direct locked-import span and is not
separately timed there. Baseline verify timings are separate observations.

Same-build direct-off control: `S3c-off-control-samples.json` and its recomputed
`S3c-off-control.json` receipt. Same30bea85 runtime,61→107fixture, one copy per
host,3warmups+20measured/direction, traceoff and proxy19344. The feature-on lane
is the ruled fast-path budget; off-mode proves delivery and supplies the control,
not an assertion that storage-only visibility always meets that budget.

Final startup-only correction125cdeb is later than the measured30bea85 runtime.
`S3c-runtime-scope.json` hashes the exact unchanged repeated-worker body and five
transport/save/session files. The supervisor retry path was independently reviewed
and tested with a busy lock and corrupt checkpoint, plus a new real local-backend
two-process CLI run. Two-host performance numbers remain explicitly attributed to30.
