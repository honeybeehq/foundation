# Comparison measurements

Engine: pixelmatch (AA excluded, threshold 0.1), unique-id matching then Hungarian assignment using text + role/name + tag + IoU + tree path, 54 fixed computed properties, CIE76 Lab colour tolerance and token mapping. Default tolerances: pixel ratio 0.001, box 1px, style 1px, ΔE 1. Reports preserve match confidence. Empty anonymous nonoverlapping boxes stay unmatched. Invisible nodes/plain unpainted wrappers disappear; sized unpainted flex/grid nodes remain. Inert width-zero border colors/styles are excluded; typography is compared on text/controls rather than empty containers.

## Controlled Chromium detection experiment

Run `pnpm exec tsx packages/proof/src/compare/measure.ts INPUT OUTPUT`. The authoritative input is SHA256 `5fd37f92bb3d214b73a36786dce7ae89d9552db29efd262cc88699de01694431`, rendered at 1280×800 DPR1. Eleven controls use isolated fixed probes over the baked document; three edit the original heading padding/color/text. Padding/color/removal include ID-free cases; wrapper is a sized ordinary unpainted block.

| Case | Injected | Found | FP | Missed | Precision | Recall | Compare ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| unchanged | 0 | 0 | 0 | 0 | 1 | 1 | 112 |
| padding | 1 | 1 | 0 | 0 | 1 | 1 | 82 |
| colour | 1 | 1 | 0 | 0 | 1 | 1 | 100 |
| remove | 1 | 1 | 0 | 0 | 1 | 1 | 108 |
| strip-ids | 0 | 0 | 0 | 0 | 1 | 1 | 147 |
| no-id-padding | 1 | 1 | 0 | 0 | 1 | 1 | 114 |
| no-id-colour | 1 | 1 | 0 | 0 | 1 | 1 | 230 |
| no-id-remove | 1 | 1 | 0 | 0 | 1 | 1 | 108 |
| wrapper | 0 | 0 | 0 | 0 | 1 | 1 | 79 |
| geometry | 1 | 1 | 0 | 0 | 1 | 1 | 84 |
| text | 1 | 1 | 0 | 0 | 1 | 1 | 85 |
| original-padding | 1 | 1 | 0 | 0 | 1 | 1 | 83 |
| original-colour | 1 | 1 | 0 | 0 | 1 | 1 | 81 |
| original-text | 1 | 1 | 0 | 0 | 1 | 1 | 92 |

These are exact single-change controls (11 positive events), not a statistical false-positive or matcher-accuracy estimate. Zero-positive controls conventionally score 1 when error-free. They compare captures from the same browser page, preserving geometry/text; they do not test cross-framework correspondence. Original heading color initially caused four inert currentColor border drifts; fixing them reduced that control from 5 findings to the expected 1. Pixel ratio for isolated colour/removal is 0.234375%; fixed empty-box padding changes style with zero screenshot change. Compare-only timing range is 79–230ms on metal-3, excluding browser startup/capture. The repository board's earlier 9-case controls also passed.

## Real Classic Tracks pair

T2 has produced four paired captures at 1416×600 DPR1 for at-rest, track-selected, proposal-pending and empty. Awaiting their collection onto the Project branch to run locally. No real-app false-positive count claimed yet.

## Proof verification

Canonical JSON sorts object keys, preserves arrays, rejects non-JSON values; reportHash and manifestHash use SHA256 without their own hash field. Reports bundle and hash DOM/meta/screenshots. Verification checks hashes, source metadata bindings, current code HEAD, clean code checkout, actual chain head or explicit sidecar digest, mandatory HTML SHA256, trusted tolerance/matrix/binding policy, and replays comparison. Missing states, not-provable states, stale bindings, dirty code, measurement mismatch or excess drift exit1.

The authoritative binary sidecar is now decoded and SHA256 verified `761bbe45118071891f18dcc7367a8149d501661d02591e6652789a79432610bf`; chain head `da6f965fcc33d4ac33d47ffd1cc04da2d288cd113b5ed263501dc50b2bac189d`. Actual CLI examples use the authoritative unchanged browser capture and its copy in an isolated git fixture: chain-head match0; chain-sha256 match0; pixel drift, stale code/design, not-provable server dependency, loose policy, missing HTML hash, omitted required state, dirty code and tampered report all exit1. Evidence: `src/report/evidence/verify-runs.json` and `verify-output.log`. These passing controls demonstrate mechanics; they do not establish app equality.

No signature: CI key ownership/trust not defined. The inactive example workflow loads policy from its base revision. Real enforcement needs a required protected check/review rules on workflows and policy. Required matrix should derive from the same reviewed links configuration, not a separately maintained list.

## Attention

reviewed by claude-opus-5-5

- Controlled exact-injection results do not establish real-pair matching accuracy; repeated labels/reorganized layout and extra flex/grid wrappers remain risks.
- Match confidence is an uncalibrated score. Inherited changes on text descendants can inflate property counts; counts are findings, not independent root causes.
- Replay proves measurement consistency for captured bytes. The trusted runner must render declared sources; hashes do not attest authenticity or a source build.
- Composite shadows compare exact strings, ΔE is CIE76 not CIEDE2000, and equal token aliases map alphabetically. Token labels do not prove CSS variable usage.
- No repository verification skill or AGENTS.md was found; no unavailable skill is claimed.
