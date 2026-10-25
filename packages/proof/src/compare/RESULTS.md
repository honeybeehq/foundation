# Comparison measurements

Engine: pixelmatch (AA excluded, threshold 0.1), unique-id matching then Hungarian assignment using text + role/name + tag + IoU + tree path, 54 fixed computed properties, CIE76 Lab colour tolerance and token mapping. Default tolerances: pixel ratio 0.001, box 1px, style 1px, ΔE 1. Reports preserve match confidence. Empty anonymous nonoverlapping boxes stay unmatched. Invisible nodes/plain unpainted wrappers disappear; sized unpainted flex/grid nodes remain. Inert width-zero border colors/styles are excluded; typography is compared on text/controls rather than empty containers.

## Controlled Chromium detection experiment

Run `pnpm exec tsx packages/proof/src/compare/measure.ts INPUT OUTPUT`. The authoritative input is SHA256 `5fd37f92bb3d214b73a36786dce7ae89d9552db29efd262cc88699de01694431`, rendered at 1280×800 DPR1. Eleven controls use isolated fixed probes over the baked document; three edit the original heading padding/color/text. Padding/color/removal include ID-free cases; wrapper is a sized ordinary unpainted block.

| Case | Injected | Found | FP | Missed | Precision | Recall | Compare ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| unchanged | 0 | 0 | 0 | 0 | 1 | 1 | 130 |
| padding | 1 | 1 | 0 | 0 | 1 | 1 | 83 |
| colour | 1 | 1 | 0 | 0 | 1 | 1 | 115 |
| remove | 1 | 1 | 0 | 0 | 1 | 1 | 128 |
| strip-ids | 0 | 0 | 0 | 0 | 1 | 1 | 91 |
| no-id-padding | 1 | 1 | 0 | 0 | 1 | 1 | 78 |
| no-id-colour | 1 | 1 | 0 | 0 | 1 | 1 | 117 |
| no-id-remove | 1 | 1 | 0 | 0 | 1 | 1 | 83 |
| wrapper | 0 | 0 | 0 | 0 | 1 | 1 | 80 |
| geometry | 1 | 1 | 0 | 0 | 1 | 1 | 88 |
| text | 1 | 1 | 0 | 0 | 1 | 1 | 100 |
| original-padding | 1 | 1 | 0 | 0 | 1 | 1 | 90 |
| original-colour | 1 | 1 | 0 | 0 | 1 | 1 | 83 |
| original-text | 1 | 1 | 0 | 0 | 1 | 1 | 99 |

These are exact single-change controls (11 positive events), not a statistical false-positive or matcher-accuracy estimate. Zero-positive controls conventionally score 1 when error-free. They compare captures from the same browser page, preserving geometry/text; they do not test cross-framework correspondence. Original heading color initially caused four inert currentColor border drifts; fixing them reduced that control from 5 findings to the expected 1. Pixel ratio for isolated colour/removal is 0.234375%; fixed empty-box padding changes style with zero screenshot change. Compare-only timing range is 78–130ms on metal-3, excluding browser startup/capture. The repository board's earlier 9-case controls also passed.

## Real Classic Tracks pair (final equal frames)

Source: T2 final capture commit `3e3745b`, Apiary commit `04c8939`, clean renderer `8316606`. Both captures share viewport 1416×720 DPR1 and a measured natural design frame: 724×468 for rest/empty, 1416×525.5 selected, 1416×611 proposal. Capture repeatability: T2 records 16/16 PNG+DOM hash pairs identical. Reports and all source images, diffs, replay captures and manifest are committed in `packages/proof/fixtures/sample-reports/`.

| State | Verdict | Raw findings | Pixels different | Compare ms | Known false property findings |
|---|---|---:|---:|---:|---:|
| at-rest | not-provable | 250 | 1.9287% | 166 | 0 |
| track-selected | drift | 513 | 2.7468% | 238 | 17 |
| proposal-pending | drift | 581 | 3.1750% | 238 | 17 |
| empty | drift | 83 | 1.2342% | 70 | 5 |

At-rest findings are diagnostic only: Classic always auto-selects, so no claim of match or product drift is made for that state. The unavailable report carries top-level `reason` plus UI-compatible `notProvable:{reason,detail,fix}`. All remaining states visibly differ: editorial list/spine plus attached/queue/proposal columns in design versus a narrower rail and graph canvas in code; empty copy, bee, button text and placement differ. The code graph's clipped lower nodes are not counted as painted content.

### Visual correspondence audit and false positives

I inspected all final full screenshots, correspondence groups and repeated-label cases. Raw output is preserved; `visual-audit.tsv` lists every finding and `visual-audit-summary.json` binds classifications to report hashes. Seven residual incorrect correspondence groups account for **39 known false property findings**: selected17, proposal17, empty5. Specifically, a design ellipsis icon is paired with a different sidecar hexagon control (5 each state), and two design inner containers are paired to broader code/harness containers (6+6 in each nonempty state). These remain documented prototype matcher limitations; confidence is not a guarantee. This is a lower bound on false product findings, not a fully adjudicated per-finding false-positive rate.

Unmatched-node findings are structural facts about the matcher, not independently confirmed missing product features. Many design labels recur in attached/queued/proposed rows; the code has them only in graph nodes or below a clipped scroll region. Inherited styles and multiple wrappers multiply counts. No corrected unique-defect count is claimed, and subtracting39 does not establish that every other raw finding is a separate genuine defect. Every raw row is classified, but correspondence-level visual review is not independent ground truth for every structural/property row.

The first real run exposed spurious IoU-only matches (queue sections paired with unrelated graph nodes). Descendant-text Dice and nearby unique-label context now gate anonymous containers; repeated uppercase type labels such as ACTION cannot match across distant rows. Viewport/overflow clipping excludes unpainted descendants. The earlier synthetic-only benchmark did not reveal these failures. A future production gate needs stable ids/anchors and calibrated confidence or human correspondence review; this prototype already rejects the visibly different states on pixels independently of matcher noise.

## Proof verification

Canonical JSON sorts object keys, preserves arrays, rejects non-JSON values; reportHash and manifestHash use SHA256 without their own hash field. Reports bundle and hash DOM/meta/screenshots. Verification checks hashes, source metadata bindings, current code HEAD, clean code checkout, actual chain head or explicit sidecar digest, mandatory HTML SHA256, trusted tolerance/matrix/binding policy, and replays comparison. Missing states, not-provable states, stale bindings, dirty code, measurement mismatch or excess drift exit1.

The authoritative binary sidecar is now decoded and SHA256 verified `761bbe45118071891f18dcc7367a8149d501661d02591e6652789a79432610bf`; chain head `da6f965fcc33d4ac33d47ffd1cc04da2d288cd113b5ed263501dc50b2bac189d`. Actual CLI examples use the authoritative unchanged browser capture and its copy in an isolated git fixture: chain-head match0; chain-sha256 match0; actual browser heading-colour mutation1; altered pixel measurement1; pixel drift, stale code/design, not-provable server dependency, loose policy, missing HTML hash, omitted required state, dirty code and tampered report all exit1. Evidence: `src/report/evidence/verify-runs.json` and `verify-output.log`. These passing controls demonstrate mechanics; they do not establish app equality. The measured-colour failure replays a real changed browser capture, not merely an edited drift verdict.

No signature: CI key ownership/trust not defined. The inactive example workflow loads policy from its base revision. Real enforcement needs a required protected check/review rules on workflows and policy. Required matrix should derive from the same reviewed links configuration, not a separately maintained list.

## Attention

reviewed by claude-opus-5-5

- Controlled exact-injection results do not establish real-pair matching accuracy; repeated labels/reorganized layout and extra flex/grid wrappers remain risks.
- Match confidence is an uncalibrated score. Inherited changes on text descendants can inflate property counts; counts are findings, not independent root causes.
- Replay proves measurement consistency for captured bytes. The trusted runner must render declared sources; hashes do not attest authenticity or a source build.
- Composite shadows compare exact strings, ΔE is CIE76 not CIEDE2000, and equal token aliases map alphabetically. Token labels do not prove CSS variable usage.
- No repository verification skill or AGENTS.md was found; no unavailable skill is claimed.

## Reopened: independent fresh-capture reproduction (2026-10-25)

The independent checker on metal-2 replayed the committed reports exactly and independently passed the verifier's stated mechanics, but fresh capture counts were249/491/594/83 (rest/selected/proposal/empty), not250/513/581/83. Fresh selected/proposal design heights were530.5/640 versus stored525.5/611. Keep these results separate; the earlier figures are stored-capture replay, not a portable from-scratch baseline. A local repeat differed by9 graph-decoration pixels, so the original16/16 bit-identical claim is not a cross-machine guarantee. See Project `research/e2e-check.md` for the independent cold-Vite failure, repeat and10-row visual sample (one ambiguous extra-content claim).

A design-only red-capable command reproduces the fresh heights on metal-3 without Apiary: `pnpm exec tsx packages/proof/src/compare/diagnostics/design-fonts.ts packages/proof/src/compare/diagnostics/evidence --expect-stored` exits1. CDP reports actual WenQuanYi Zen Hei Mono for metadata node n212::n139, whose box is167.78125×14 instead of208.625×12, despite the same computed family/size/normal line-height. T2 independently measured metal-1's face as DejaVuSansMono. Sans title boxes are identical. Changing only the mono face to embedded LiberationMono changes frames to524.5/612 and metadata to207.9375×12, proving the font-metric dependency rather than attributing it vaguely to machines or source revisions.

T2 owns the fix: bundle actual font bytes, pin alias resolution, audit rendered platform faces and fail closed on unbundled glyphs, and replace the cold Vite optimizer path. Do not overwrite the stored results until the fixed captures are independently checked. No new portable-equality or deterministic-repeat claim is made yet.
