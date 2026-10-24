# Capability command startup

Run `node packages/cli/scripts/capabilities-proof.mjs --out .audit/S6b/built.json` and repeat with `--source --out .audit/S6b/source.json`. Each run uses20fresh processes and a disposable checkout/HOME. It checks unknown/missing/stamped runtimes, working-tree-only and missing designs, non-Git roots, inherited Git environment, symlink escapes, single-line JSON and unchanged fixture hashes. Trash only the fixture path printed by the driver; keep receipts.

Budget: local warm-cache p95<300ms, ruled in S6b2026-10-24T19:08:16Z. Includes fresh process startup, stamp reads and one100ms-limited Git HEAD query. Excludes remote transport, session/edit startup and installation-time bundle compilation. CLI launchers built by install dispatch capabilities to the light bundle; source CLI uses lazy command imports.

Studio Node24.20.0 observed source p95=159.51ms and built p95=39.33ms in the retained S6b proof; shared host load19-22 precludes a stable baseline or fleet-wide guarantee. Initial eager-source p95=354.60ms is retained as the failed same-workload run. Source and built are separate series; do not compare them as one population. The metric stays recipe-only because no quiet reference series was established. Check each receipt with `node packages/cli/scripts/perf-map.mjs check <receipt>`; correctness invariant and300ms budget still apply.
