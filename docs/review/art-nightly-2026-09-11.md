# Foundation nightly review — 2026-09-11

Main now rejects invalid verification launch combinations and malformed deploy options before they can choose the wrong runtime or installation target. The test entry point runs Vitest and Node suites with their respective runners. Lease guidance includes the measured `lease_held` outcome. Deploy help uses the already imported filesystem module instead of a redundant dynamic import/promise chain.

Source review covers all **49 frozen candidates**, including 40 resumed candidates verified against their exact prior raw diffs. A second source/simplification pass covers 45 file records, including the new test/config files. **Runtime acceptance remains incomplete** for the named gates below. No push, deployment, installed-app replacement or shared-checkout edit was performed by this lane.

## Source and changes

Frozen main: `1148bbfaeee16c524ab17eeb85434f3c18cec5ec`. Reviewed source head: `e3d9823bbe7f4f3110473b0bb75cc1bf5e21e504`.

- `a81ce0e37972b69da3edffeb06803eee77476a9a` — fix(verification): reject invalid desktop launch combinations
- `d9817e9f0fa0ef9950193a19dd087abbb6726573` — fix(desktop): reject invalid deploy options before installation
- `e4751b144f49e428856dc0b29951f57c37ae3b64` — fix(test): run desktop Node suites with their native runner
- `739d89e37129ddad0339f30cfc746ec4973501b3` — docs(verify): recognize explicit publisher lease contention
- `e3d9823bbe7f4f3110473b0bb75cc1bf5e21e504` — refactor(desktop): read deploy help without a redundant import chain

Every candidate SHA and raw-diff SHA-256 is in the [portable evidence receipt](art-nightly-2026-09-11-foundation-evidence.json). Regenerate each digest with the recorded full-index/binary diff command. Three newly landed patches match previously reviewed branch patches byte for byte; the native-titlebar branch/main pair also matches. Reuse is based on immutable objects and bytes, not commit subjects. The native window/renderer changes and final control/deploy callers were inspected directly.

The previous `41ab77d` guards were absent from frozen main despite remote-control code having landed there. Adding the same assertions on main produced two **Missing expected exception** failures (3/5 passed). Both launch contracts now pass (5/5): package verification uses its bundled runtime, and recovery requires an explicit shared backend plus document ID. This repair deliberately rejects the previously working combination of a packaged renderer with an explicitly selected external host: that combination could not substantiate a claim about the package’s bundled runtime. It is a verification-contract correction, not a behavior-preserving simplification.

Malformed `--target` and `--no-instal` previously passed argument parsing. Tests use an intentionally missing runtime to stop the baseline before any build or install. The repaired parser rejects them first. One initial test expected version-specific Node wording; the final assertion checks `ERR_PARSE_ARGS_INVALID_OPTION_VALUE`, and the corrected baseline/final comparison confirms the guard remains absent before and present after. Failed attempts remain in the local evidence, with digests in the portable receipt.

## Verification

- Original full invocation: **69 Vitest suites / 720 tests passed**, but two Node suites produced **No test suite found** errors. The repair excludes those files only from Vitest and explicitly runs them through Node in `pnpm test`.
- Corrected serial invocation, `pnpm exec vitest run --maxWorkers=1`: **69/69 suites, 720/720 tests passed**, exit 0. `node --test packages/desktop/scripts/*.test.mjs spikes/desktop-prototype/model.test.mjs`: **12/12 passed**, exit 0.
- An intermediate `pnpm test -- --maxWorkers=1` forwarded the worker flag to the final Node command, leaving Vitest at default parallelism. That invocation timed out under load and was stopped using its owned process tree. It is retained as a failed attempt; no claim is made that default parallel `pnpm test` passed under this load.
- `pnpm typecheck` and `pnpm --filter foundation-desktop build` passed. Final production/test TypeScript is unchanged from those checks; the new Vitest config was loaded by the successful serial run. The desktop build emitted a 2849-byte seed and two image assets.
- Fresh, locally signed package acceptance passed: two independent replicas with offline edits/comments, complete-document convergence, per-replica disconnect, both client restarts, standalone bundled-host startup, local Comb publication, saved reopen, and clean teardown. A screenshot timeout was recovered by the existing bounded refocus/retry. That is **not** deliberate occlusion proof.
- Deploy help output before/after simplification is byte-identical, exit 0; its SHA-256 is `8516e481ea0fec4bdfeb31a6ac01de66e55a542466eb25140d7ca3e1e23e2ef2`. Both deploy-option regression tests pass after simplification. No install path was exercised to prove this change.

## Package provenance

The fresh package was built from frozen main's exact desktop sources. Subsequent source changes affect control/deploy scripts, tests and guidance; no bundled renderer/main/preload/model/runtime, build script or lockfile changed. The same accepted immutable host runtime used in prior remote proof was copied into the new package. Package proof hashes:

| Component | SHA-256 |
|---|---|
| hostEntry | `e95665ef932c3e84b2220262aae8f8f3194c7af984812db1146faa3794032e89` |
| comb | `a0489c7e4414a1c524c71d0a3ffc4c7b9d968483f8510ad1640c784784c072f1` |
| node | `9d050fd455b56426e25d4d603c7c501cbb2630348e836cf221dcce748e90588a` |
| desktopMain | `d3de252c6c20fc54f467b10c5e1f0ad3edae6556649cd2eeb76f8f4d600e5c8f` |
| desktopRenderer | `c0370d370b2e2255f8cf0beadc868133393479dba6becf3521daf3130964ed15` |

The retained same-machine MinIO proof at `41ab77deeeaf59fe45299363ed3dadf82b87bc85` **passed** recovery and publisher-lease handoff with two independent hosts/replicas. It is not pending, and it is not an external two-machine or outage proof. Its exact report digest is in the portable receipt.

## Unresolved gates

- Native macOS export dialog: choose/cancel/fresh destination/collision and inspect HTML+chain. CUA getApp timed out before any interaction; unit host forwarding/collision and package data proof are not this test.
- Forced occlusion and native titlebar controls: deliberately cover/minimize owned window and prove rendering/capture/restore plus drag/traffic-light targeting. One real package screenshot timeout retried successfully, but no deliberate occlusion was injected.
- Manual bundled open-two-clients launcher execution still not rerun; package contains exact launcher bytes and live-proof independently passes2clients/standalone, but these are distinct entry points.
- External two-machine recovery/convergence/lease handoff: erebor-mini02 reachable arm64+Node; no expected runtime or checkout. Needs only an isolated runtime copy and a scheduled broad slot; verification is already authorized, with no installation or shared mutation.
- Controlled backend outage: own isolated backend only; record local persistence/pending/error during outage then restart/reconnect/convergence. Prior same-machine MinIO recovery/lease pass does not cover outage.
- Investigate custom --target deploy shutdown: pgrep uses an unescaped target regex and osascript tells application Foundation by name. With multiple copies, correct target selection is unconfirmed; do not execute install or quit operator apps to reproduce. Needs a bounded native fixture/owner followup.

The owned native control session reached ready, then stopped with host/client exit 0, no lifecycle errors, and scratch archived. The native driver timed out selecting the app before any dialog/occlusion interaction. SSH readiness found an arm64 second Mac with Node, but no Foundation runtime or checkout at the expected paths. Nothing was provisioned remotely. These are explicit handoff limits, not passed checks.

## Root integration supplement — two-machine host and outage proof

The external host/API network and backend-outage bullets above are superseded by this passing supplement. The verified package host runtime was copied into an owned temporary directory on `trmd-erebor-mini02`; all 44 payload file hashes matched, and its Node/Comb executables started. No app was installed.

Two real hosts on different Macs recovered equal complete documents under distinct replica identities, observed publisher lease contention, handed publication to the second machine, and converged. Pausing only the owned MinIO backend preserved a locally saved edit and pending publication, produced a paused sync state, and did not falsely clear pending work. After unpause, publication resumed and the peer converged. Both service sessions acknowledged close, both host processes exited 0 and were confirmed absent, and the backend returned to stopped/unpaused.

This uses the ordinary authenticated host HTTP API over owned loopback SSH tunnels. It does not claim second-machine desktop interaction, native dialogs, UI footer/restart behavior during outage, backend crash recovery or ambiguous-ack handling. The first attempt failed because `/tmp` and `/private/tmp` differed at the Node entry-point check; it is retained separately. The successful retry used canonical paths.

The [portable network receipt](art-nightly-2026-09-11-foundation-network.json) records each assertion, machine/PID provenance, cleanup and exact runtime/driver/source-receipt hashes. These supplement the immutable worker report and do not change any project source after its verification.
