---
name: perf-foundation-sync
description: Measure Foundation sync latency and read-only capability command startup, with bounded local recipes on Studio and metal-3.
---
# Foundation sync and capability performance

Read workloads/README.md and sync-save-to-session.{json,md}. The map covers sync and the bounded doctor-capabilities startup probe; this is not a whole-engine performance inventory. For capability routing, read doctor-capabilities.{json,md}; run its local isolated recipe without the S5 shared-store setup.

Launch/doctor: coordinate the S5 temporary setup; same installed candidate and fixed fixture on both nodes, quiet mutation window, capture host/runtime/load and fast clock brackets. No uncoordinated active-feed edits. Store credentials stay in private untracked config.

Measure: reuse the S5 session-commit/event driver (Project research/S5-latency-harness.txt). Collect at least20 samples per direction. Opt-in stage tracing and traced S3 proxy attribute work; separate unprofiled runs decide latency. Keep failed samples and all-hints-lost correctness. Do not subtract unbounded host clocks.

Compare: same fixture, hosts, runtime, build, store and collector is one series. Targets are p50<=1000ms/p95<=1500ms per direction, ruled in task S3c. Upper-bound samples must include clock uncertainty. Raw old S5 runs are context, not a comparable baseline.

Map: node packages/cli/scripts/perf-map.mjs census|validate|index|drift. Check a retained receipt with `node packages/cli/scripts/perf-map.mjs check RECEIPT`. Gap metrics must not be relabeled measured until the actual recipe runs. Tool supports exact file roots as well as directories.

Evidence/cleanup: compact receipts and per-stage table belong in packages/cli/performance/; bulk traces/credentials stay in .audit. Stop only profiling daemons/hint listeners and preserve evidence. Do not stop S5 shared services. Pilot completed on2026-10-24: actual direct receipt passes all four targets; a deliberately worsened receipt fails all four. Inbound concurrency and catalogue retention remain gaps.
