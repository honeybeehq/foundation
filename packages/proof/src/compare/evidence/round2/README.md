# Round 2: matching quality and candidate defect counts

The checker reports **24 / 24 / 20 product candidates** for selected / proposal / empty. **10 / 11 / 10** have one-to-one layer/property support in the independent hand-labelled list of **31 / 35 / 14** product differences. These are candidate counts, **not an accurate count of unique real causes**. Matching false positives improved; the main unique-real-defect goal remains unmet. At-rest stays **not provable**, without a real-defect count.

## Held-out results and the recall cost

The last iteration tuned only track-selected, froze matcher/grouping commit `e419831`, then evaluated proposal and empty. Their earlier aggregate results had already been seen. Proposal shares 27 of 36 label slugs with selected, so it is a near-duplicate state held out from this iteration, not evidence of independent generalization. No held-out error lists were used during tuning.

| State | Candidates before → after | Supported before → after | Unmatched before → after | Precision before → after | Recall before → after |
|---|---:|---:|---:|---:|---:|
| Selected (tuning) | 111 → 24 | 19 → 10 | 92 → 14 | 17.1% → 41.7% | 61.3% → 32.3% |
| Proposal (related holdout) | 124 → 24 | 20 → 11 | 104 → 13 | 16.1% → 45.8% | 57.1% → 31.4% |
| Empty (holdout) | 25 → 20 | 10 → 10 | 15 → 10 | 40.0% → 50.0% | 71.4% → 71.4% |

“Supported” is an optimistic machine comparison with blind R1 labels, not a second human confirmation of each candidate. The scorer requires a compatible raw property and a design **or** code path within a labelled scope, then uses maximum one-to-one assignment. Prefix scopes include descendants. Root scopes and wildcards are permissive. Missing/extra matches require `subtree`; a missing text node does not automatically match a `text` label. Assignment ties can move support between related labels. All assignments, unmatched candidates and missing labels are saved in `*-metrics.json`.

## Sensitivity: uncertainty and merged causes

| State | Product candidates | Uncertain groups | One-to-one support | Support / product | Support / (product + uncertain) | Support excluding broad scopes |
|---|---:|---:|---:|---:|---:|---:|
| Selected (tuning) | 24 | 18 | 10 | 41.7% | 23.8% | 9 / 24 |
| Proposal (related holdout) | 24 | 18 | 11 | 45.8% | 26.2% | 10 / 24 |
| Empty (holdout) | 20 | 0 | 10 | 50.0% | 50.0% | 8 / 20 |

The broad-scope sensitivity removes labels with a literal `0`, `0/0` or bare `*` scope on either side, then reruns assignment. It leaves at most **9 / 10 / 8** supported candidates. The inclusive column retains the original product support numerator and charges uncertain groups in the denominator; it does not claim those groups are false. Precision on certain matches and product candidates excludes abstentions, while recall still charges missing labelled causes.

One selected regional candidate absorbs **294 raw findings and evidence for 10 labels**; its proposal counterpart absorbs **319 findings and evidence for nine labels**. Each scores only one supported candidate. Six of the nine labels lost from one-to-one agreement in each state are inside this merged region. Seven uncertain row-region groups also absorb real row differences; those labels leave the product count. This improves the apparent precision by both grouping and abstaining, and loses independent causes. Per-candidate label counts, including uncertain groups, are in `*-coverage.json`.

| State | Labels with any product evidence | Labels with any evidence including uncertain groups | Ground truth product differences |
|---|---:|---:|---:|
| Selected (tuning) | 19 | 24 | 31 |
| Proposal (related holdout) | 18 | 23 | 35 |
| Empty (holdout) | 10 | 10 | 14 |

These union counts show evidence coverage only. They do not turn a composite candidate into multiple detected independent defects.

## With and without optional layer ids

| State | IDs | Product candidates | One-to-one support | Product precision | Product recall | Uncertain groups | Inclusive support proportion | Raw findings |
|---|---|---:|---:|---:|---:|---:|---:|
| track-selected | present | 24 | 10 | 41.7% | 32.3% | 18 | 23.8% | 712 |
| track-selected | both sides stripped | 11 | 6 | 54.5% | 19.4% | 42 | 11.3% | 738 |
| proposal-pending | present | 24 | 11 | 45.8% | 31.4% | 18 | 26.2% | 761 |
| proposal-pending | both sides stripped | 11 | 6 | 54.5% | 17.1% | 42 | 11.3% | 787 |
| empty | present | 20 | 10 | 50.0% | 71.4% | 0 | 50.0% | 112 |
| empty | both sides stripped | 6 | 5 | 83.3% | 35.7% | 0 | 83.3% | 79 |

One environment group per anchored state covers the declared Linux font-family substitution. Without ids, empty has no matched text and therefore no measured font-family group. No reviewed acceptance list is applied in these R2 measurements (`accepted: 0`). R3 owns acceptance and CI integration. `uniqueDefects` includes accepted product candidates; unresolved = `uniqueDefects - accepted`.

## Round 1 versus round 2 correspondence

Both matcher versions run on the same new captures. The “ids present” round-1 run is a counterfactual using newly available anchors. The ids-free round-1 run reproduces the original raw totals 513 / 581 / 83. Transparent coextensive single-branch wrappers are equivalent for scoring. Only R1 `sure` rows enter these metrics; unsure rows (21 / 41 / 1) are excluded, with uncertain predictions treated as abstentions. Precision counts only certain predictions in this labelled scope. Recall counts every sure mapped design layer, including those the screenshot-limited matcher cannot see.

| State | IDs | R1 TP / FP / FN | R1 precision / recall | R2 TP / FP / FN | R2 precision / recall | R2 abstentions in sure scope |
|---|---|---:|---:|---:|---:|---:|
| track-selected | ids | 21 / 2 / 38 | 91.3% / 35.6% | 17 / 0 / 42 | 100.0% / 28.8% | 14 |
| track-selected | no-ids | 18 / 3 / 41 | 85.7% / 30.5% | 14 / 0 / 45 | 100.0% / 23.7% | 17 |
| proposal-pending | ids | 23 / 2 / 33 | 92.0% / 41.1% | 18 / 0 / 38 | 100.0% / 32.1% | 14 |
| proposal-pending | no-ids | 20 / 3 / 36 | 87.0% / 35.7% | 15 / 0 / 41 | 100.0% / 26.8% | 17 |
| empty | ids | 5 / 1 / 5 | 83.3% / 50.0% | 5 / 0 / 5 | 100.0% / 50.0% | 0 |
| empty | no-ids | 1 / 1 / 9 | 50.0% / 10.0% | 1 / 0 / 9 | 100.0% / 10.0% | 0 |

All seven audited bad pairs cease to be **certain** pairings, covering the 39 known false round-1 property findings. With anchors all seven pairings disappear. With ids stripped, two broad body↔root proposals remain explicitly uncertain; the other five disappear. This does not establish that all descendants of uncertain regions are correct.

Round 1 had no unique-defect model, so genuine round-1 unique-defect precision/recall is **undefined**. `round1-summary.json` also contains a clearly named raw-as-defects diagnostic (each raw row charged as a separate candidate); it is not comparable to unique-cause precision and is not used as evidence of improvement. The focused before/after table compares two grouped models and shows the recall tradeoff directly.

## Rules and contract

- Reserve unique `data-fdn-id` pairs and constrain descendant matching to their tree boundaries. Duplicate ids do not claim identity. Existing design ids are unchanged.
- Compare SVG primitive structures so circles do not silently identify a path icon. Bare relocated numeric labels do not establish identity. Distinctive descendant text can locate moved containers.
- Mark competing or sparse container candidates `uncertain: true` with a reason. Infer wrapper correspondence from reserved descendant content, retaining uncertainty. Transparent extra wrappers keep their paths for audit.
- Keep every raw drift. Group missing/extra subtrees, inherited computed styles at the highest compatible ancestor, repeated geometry deltas, ancestor padding consequences and exact adjacent sibling size/shift effects. Layout settings and geometry share a layer candidate; surface paint/radius/shadow share a surface candidate.
- For an uncertain region, require an agreeing enclosing correspondence and comparable box scale. Multiple new absolute-positioned descendants plus shared text anchors identify a structural layout replacement. Prefer the smaller region preserving most anchors. A single-anchor changed region stays uncertain. This is a heuristic hypothesis about cause, not CSS declaration provenance.
- Font-family differences under the declared Linux substitution are `environment`. No global waiver for font weight, geometry or arbitrary authored custom fonts is applied. Direction-dependent `start` versus `left` alignment stays uncertain; line-height folds into layout.

`defects[]` has `{id,layer:{design?,code?},kind,classification,cause,findings,summary,accepted?}`. Classification is `product|environment|uncertain`. `findings` references preserved raw drift ids. Stable defect ids hash layer/kind/cause, excluding measured values and sequential raw ids. `summary` contains `uniqueDefects`, `accepted`, `raw`, `uncertainMatches`, `environment`, `uncertain`. Canonical sealing covers these additions. R3 owns acceptance snapshots, full verification replay and CI.

Initial rules were frozen at `8fb1c70` / collected `fcd4174` before opening R1 labels. Post-label rules: geometry/layout configuration, anchor boundaries, distinctive descendant text, sparse uncertainty; then selected-only region grouping, reserved-descendant wrapper inference, surface families, directional alignment uncertainty, line-height folding and adjacent sibling consequences. No R1 ids, slugs, node ids or specific text are encoded in matcher rules. Final matcher/grouping is frozen at `e419831`; later changes are scoring, documentation and evidence only.

## False positives and misses

Every one of the 92 selected candidates unmatched before the focused iteration is classified in `before-focused-selected-false-positives.tsv`. This is an audit of unmatched predictions, not proof every unmatched row is visually false: label scope and coarser cause granularity also matter.

| Producing rule class | Selected before | Selected after | Proposal after | Empty after |
|---|---:|---:|---:|---:|
| missing structure not folded | 24 | 4 | 4 | 4 |
| extra structure not folded | 22 | 4 | 3 | 0 |
| inherited or text styling | 26 | 1 | 1 | 2 |
| geometry or layout consequence | 17 | 4 | 4 | 4 |
| paint or box styling | 3 | 1 | 1 | 0 |

No environment or explicitly uncertain group enters the product denominator. Wrapper errors appear in the structural classes; the table does not claim that every structural mismatch is a wrapper. Geometry/configuration candidates can still be implementation differences already explained by a higher-level cause.

Examples: the pane root still has a product layout-configuration candidate for position/box-sizing/overflow without an independent labelled cause. Header and footer copy replacements can appear as separate missing/extra subtrees rather than one text replacement. Empty heading/copy geometry groups duplicate a single vertical-rhythm cause. The grouped graph region hides Exceptions, per-step style and the missing SPINE header as independent causes. Row metadata causes move into uncertainty.

**Critical miss:** P-28, the proposal accept/discard bar, is R1’s only clearly unintended difference. Its code box is around y=1023 in a 720px viewport; the checker has zero raw evidence for that off-screen/clipped subtree. The count therefore does not establish detection of the known unintended defect. It compares visible captured content, not scroll reachability or interaction correctness.

## Sources, capture and runtime

Foundation baseline `3e3b0a3`; matcher/grouping `e419831`; R1 labels `119b41e` plus reconciliation `e6a518d` / Project `1eadede`. Apiary anchor source **`47ea4b5dc07d589f62069365fb51893feecf1851`**, pushed only to `proto/design-to-code-tracks` after fetch/rebase. Two anchor commits change six production files: **15 added / 13 removed lines**. No repeated row-name fixture mapping, format change, or visible component replacement. Later Apiary branch head observed `ab8ab87d15f90af37caa6f28cb2a0253603e1d1f` includes R3 work; measured captures bind to the anchor source above.

Clean capture: Chromium 151.0.7922.34, Linux, pinned font bundle, renderer `3e3b0a3`, rendererSourceHash `df66be2348c724908b98a4076213748b99413e582548b8deca7c214991c4a69f`. Capture CLI **29.936s**. All eight screenshots byte-identical to canonical `6a3dbb9`; seven/seven/five ids per selected/proposal/empty DOM, with six/six/five visual id matches (the list wrapper itself is not visual). No duplicates or outside-design-subtree anchors in provable states. At-rest’s diagnostic-only ids do not establish an available state.

Final anchored compare-only times: **337 / 295 / 87ms**, excluding capture, file reading and label scoring. The six ids/no-ids comparisons span 87–337ms. Historical round-1 canonical compare times were 208/238/83ms; no speed improvement is claimed. All **796 tests**, **14 real Chromium controls**, six report hash/raw-partition/id-uniqueness/tamper checks pass. A temporary extracted round-1 test initially polluted test discovery; removing that copied test restored the full suite. The repository verification skill was unavailable; existing verification commands ran instead.

## Reproduce and inspect

Live evidence gallery: https://trmd-metal-2.tailff9529.ts.net:8465/matching/index.html (same Nectar environment as the capture gallery). It includes the before/after table, both fixed-pair images, and every candidate with possible supporting labels.

Prerequisites: repository frozen lockfile dependencies and pinned Playwright Chromium. Download the anchor capture archive from the gallery, verify SHA256 `281c7ec09faf1a833f3c6728d0af855769945abd907b2157f203a19f03fd1147`, then extract to `.audit/r2-anchors`.

```sh
pnpm install --frozen-lockfile
pnpm exec tsx packages/proof/src/compare/round2-measure.ts .audit/r2-anchors .audit/r2-recheck
pnpm exec tsx packages/proof/src/compare/round2-coverage.ts .audit/r2-anchors .audit/r2-recheck
pnpm exec tsx packages/proof/src/compare/round2-integrity.ts .audit/r2-recheck .audit/r2-anchors
pnpm exec tsx packages/proof/src/compare/measure.ts packages/proof/fixtures/design/tracks-pane.fdn.html .audit/controls
```

The measurement command regenerates reports, full candidate lists, assignments and missing labels. For the original matcher, extract `packages/proof/src/compare` from git `3e3b0a3` under `.audit/round1` (remove its copied `*.test.ts` from test discovery), then pass its `index.ts` as the fourth measurement argument. The fifth argument filters states, e.g. `- track-selected` uses the current matcher on selected only.

Evidence lives in `packages/proof/src/compare/evidence/round2/`: report JSON, full metrics/coverage, controls, capture fingerprints, false-positive TSVs, integrity receipts and two annotated fixed-pair screenshots. Full product/uncertain/environment lists are in the report JSON; the proof gallery renders each candidate with all possible supporting label ids. Capture gallery: https://trmd-metal-2.tailff9529.ts.net:8465 (`nectar://trmd-metal-2/dtc-r2-anchors--r2-layer-anchors--web`).

## Attention

Reviewed by claude-opus-5-5 (session `31dd8642-1448-4f31-ae9a-0d5cf995ba28`), who independently reran both matcher versions and reproduced the tables. Its six flags are reflected above: composite causes, excluded uncertainty, correlated holdout, the off-screen unintended miss, broad scope scoring and low correspondence recall. Project audit: `decisions/R2-audit.md`.

Next work: retain multiple independent causes inside a region, separate CSS declaration provenance from computed coincidence, improve content-replacement correspondence, and explicitly test scroll/interaction visibility. Do not use 24/24/20 as a validated unique-real-defect KPI or a strong automated release gate.
