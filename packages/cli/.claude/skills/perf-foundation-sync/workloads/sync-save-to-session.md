# Shared-store save to remote session

Population: installed CLI/session/daemon on Studio and metal-3, fixed clone of S5 design, quiet coordinated window, traced proxy19344 on the same temporary S3-compatible store. At least20 samples per direction; retain every failure. No other mutation driver runs concurrently.

The task rules p50<=1000ms and p95<=1500ms. Measure local stages with their own monotonic clocks; never subtract uncalibrated cross-machine timestamps. Calibrate fast clock endpoint with RTT brackets before/after, retain uncertainty, and use conservative upper bounds for acceptance. Profiled runs attribute only; unprofiled runs decide before/after latency. Same fixture/runtime/build/store/visibility/probe policy is one series; do not compare S5 old mixed versions or CLI cold startup.

Reuse research/S5-latency-harness.txt driver; add trace download/clock bracket support there rather than building another edit driver. Stage trace records: save, notice, append RPC, bounded read, verify, locked import and session event, correlated by envelope hash. S3 proxy trace provides service durations and request categories/CAS flags; never log auth, payloads or object paths.

Metadata traffic and full history scans remain linked costs; hint loss must still converge via Comb. Matched receipts are retained in packages/cli/performance/S3c-{baseline,direct}.json. Initial61-change fixture was restored byte-for-byte before each unprofiled series; three warmups plus twenty measured edits per direction produced107changes. Direct candidate30bea85 passes all four ruled limits with a2ms timestamp quantization guard. Profiled runs attribute only; the direct profile hit10/10 before Comb, with every later Comb import a duplicate. Final outage proof is tracked separately.
