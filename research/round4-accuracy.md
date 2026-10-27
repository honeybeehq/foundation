# Round 4 accuracy

**Target not met. Keycap and InboxRow pass on tuning, with selected InboxRow exactly on threshold (7 of 10 candidates). HelpCenter and Tracks fail; HelpCenter strict recall regresses from 52.4% to 47.6%. Held-out pooled precision fails at 35.5%, and HelpCenter-search fails both precision and recall (9.8% / 30.8%). Rules were derived case by case, and the strict scorer was extended after observing Tracks misses. These results do not establish generalisation.**

## Scoring contract

Each candidate can claim at most one labelled product cause, and each cause can be claimed once. Environment labels and uncertain candidates are excluded from precision; missed causes, including those moved into uncertainty, remain in recall. Labels were never edited by the tuner. H-02 received a labeller-owned syntax-only CSV repair before freezing.

R2 optimistic support retains shorthand expansion and compatible-property evidence on either tree prefix scope, including broad wildcards. Strict support requires every available evidence side to agree with a finite labelled scope, rejects a bare whole-tree wildcard, and requires an absent side to be labelled none. Strict also resolves the spatial vocabulary top/y, left/x and position/offscreen. Strict is still automated evidence support, **not** fresh human confirmation or proof that every grouped row is exactly one real cause. These vocabulary differences mean strict need not be numerically below optimistic. Both use the same final scorer for before/after.

The pre-change Tracks baseline uses U2 reports on the new Flow View captures, not obsolete round-2 labels. Component reports are the saved round-3 reports. Rules and labels are identified in decisions/A1.md.

## Tuning results with ids

Entries are precision / recall in percent. Product cause counts use the corrected labels; zero-truth empty is shown by false-positive count rather than a precision percentage.

| Case | Causes | Before strict | After strict | Before R2 optimistic | After R2 optimistic | Strict target |
|---|---:|---:|---:|---:|---:|---|
| keycap / default | 3 | 75.0 / 100.0 | 100.0 / 100.0 | 75.0 / 100.0 | 100.0 / 100.0 | MET |
| inbox-row / selected | 7 | 31.2 / 71.4 | 70.0 / 100.0 | 31.2 / 71.4 | 70.0 / 100.0 | MET |
| inbox-row / failed | 6 | 23.5 / 66.7 | 85.7 / 100.0 | 23.5 / 66.7 | 85.7 / 100.0 | MET |
| help-center / agent-run | 21 | 8.9 / 52.4 | 15.6 / 47.6 | 10.5 / 61.9 | 20.3 / 61.9 | NOT MET |
| tracks-flowview / track-selected | 3 | 0.0 / 0.0 | 10.0 / 66.7 | 0.0 / 0.0 | 5.0 / 33.3 | NOT MET |
| tracks-flowview / proposal-pending | 3 | 0.0 / 0.0 | 7.4 / 66.7 | 2.9 / 33.3 | 3.7 / 33.3 | NOT MET |
| tracks-flowview / empty | 0 | 7 FP; P/R undefined | 4 FP; P/R undefined | 7 FP; P/R undefined | 4 FP; P/R undefined | NOT MET: false positives remain |

Full assignments, raw evidence, every false candidate and every missed cause are in [before](round4/before/summary.json), [after](round4/after/summary.json), and the case JSON files beside them. The [error analysis](round4-error-analysis.md) classifies the pre-change disagreements; old Tracks labels are used only as historical diagnostics.

## Reclassification and small denominators

Counts below distinguish product candidates from uncertainty/environment. Moving a candidate out of the product denominator can improve precision without fixing the underlying correspondence; it does not establish absence of a defect. HelpCenter's collection-data change loses labelled recall.

| Case | Product before → after | Uncertain before → after | Environment before → after | Strict TP / FP / FN after |
|---|---:|---:|---:|---:|
| keycap / default | 4 → 3 | 0 → 0 | 0 → 1 | 3 / 0 / 0 |
| inbox-row / selected | 16 → 10 | 1 → 11 | 0 → 1 | 7 / 3 / 0 |
| inbox-row / failed | 17 → 7 | 1 → 13 | 0 → 1 | 6 / 1 / 0 |
| help-center / agent-run | 124 → 64 | 31 → 76 | 0 → 1 | 10 / 54 / 11 |
| tracks-flowview / track-selected | 29 → 20 | 38 → 49 | 0 → 0 | 2 / 18 / 1 |
| tracks-flowview / proposal-pending | 35 → 27 | 53 → 59 | 0 → 0 | 2 / 25 / 1 |
| tracks-flowview / empty | 7 → 4 | 0 → 3 | 0 → 0 | 0 / 4 / 0 |

Selected InboxRow is **on threshold**, not a margin: one additional false candidate would take precision below 70%. Populated Tracks has only three labelled causes per state; 66.7% means two causes found.

## Post-label scorer changes on tuning

The strict-only spatial vocabulary was added **after** inspecting Tracks labels and zero-support results: position/offscreen first, then top/y and left/x. It initially entered the shared scorer, then was isolated from R2 optimistic support before freeze. This was a post-label scoring change, not independent detection evidence. The final before/after tables both use the same frozen scorer; the historical experiment order is recorded in decisions/A1.tsv.

The existing tuning assignment evidence separates the effect without rerunning held-out scoring:

| Tracks tuning state | Strict hits using R2 property vocabulary | Additional hits relying on new spatial vocabulary | Frozen strict total |
|---|---:|---:|---:|
| Selected | 1 / 3 (width: TS-03) | 1 / 3 (top/y: TS-02) | 2 / 3 |
| Proposal | 0 / 3 | 2 / 3 (top/y: PP-02; position/offscreen: PP-01) | 2 / 3 |

This is an inspection of saved tuning evidence, not a second held-out score. The bar detector still physically finds the bar; whether a top/position label is credited for that evidence is a separate scoring decision.

## Generic changes

- Render-equivalent authored fallback stacks remain raw evidence but become environment findings. Textless containers no longer produce inherited text-style findings. Borderless equivalent box-model and inactive positioning/flex configuration remain uncertainty.
- Exact unique direct copy can match across tag/accessibility-name wrappers. A single unmatched text slot inside an established boundary can represent a copy replacement; one icon within a text-anchored component can represent an icon replacement. Captured icon shape and local ancestor transforms provide previously absent evidence. Inert SVG authoring groups are ignored.
- Repeated line-height ratios fold descendant height/vertical consequences into the corresponding ancestor. Structural replacement regions no longer absorb independent measured geometry and styling. Transparent unmatched wrappers with all text descendants already matched remain uncertainty.
- Substantially changed repeated collections group structural/text data evidence as uncertainty, while independent layout and styling stay eligible. This reduces false product rows but also loses recall for fixture-derived labels; no claim is made that uncertainty proves the data is correct.
- Off-screen content within an in-frame functioning scrolling viewport is reachable, so it is not an independent visibility defect. Existing tests for new scrolled content and displaced scrolled content were updated to this contract. Clipped repeated labels use uniquely named nearby content rather than global word identity. A compound action bar can inherit a design counterpart from multiple unique control labels. A duplicate size/offscreen cause at the same root is combined.
- Supplemental unique-text and nearest multi-anchor card correspondence exposes geometry below the fold outside scrollable sample lists. It compares geometry only, and excludes the capture root. This improves Tracks recall without pretending every hidden node is correctly paired.

Malformed CSV field counts now fail explicitly rather than silently shifting the property column.

No component names, label ids, or hard-coded node ids appear in these rules. No capture implementation or design format changed.

## Before/after evidence excerpts

1. **Keycap unused fallback stack:** before, font-family reported `"IBM Plex Mono", monospace` versus `"IBM Plex Mono", ui-monospace, monospace` as a fourth product cause. Both normalized rendered stacks were identical. After, its raw font evidence remains, but it is environment; product causes go 4 → 3, strict 75/100 → 100/100.
2. **HelpCenter scroll catalogue:** before, the off-screen detector contributed 37 clipped catalogue subtrees as product candidates. After, an in-frame functioning scroller makes these rows reachable. The captured geometry is retained, but these are no longer visibility defects. Data/sample differences are separately uncertain, not silently accepted as correct.
3. **Tracks repeated words:** U2 had four off-screen ACTION/INSTRUCTION alarms plus the real action bar. After, only the real bar remains. The regression test runs all three committed Flow View captures and asserts offscreen counts 0 / 1 / 0; proposal summary includes Accept.

## Verification and known-bug status

- Fourteen original controls compare exactly to stored result rows across scenario, expected/found, TP/FP/FN, precision/recall and pixelRatio. The extra off-screen control also passes. [Receipt](round4/checks/controls.json).
- The three pixel ratios named as a known bug were **already corrected in the fetched baseline**: original-padding 0.00087109375, original-colour 0.0005859375, original-text 0.0008017578125. No baseline was rewritten to conceal a difference.
- Deterministic normalised replay: two compare() calls in one process on stored captures produced byte-identical normalized reports and diff PNGs for all seven cases. Timings and the timing-dependent reportHash are excluded from normalized report equality; full reports are not claimed byte-identical. Captures were read unchanged; this is a checker replay, not a fresh production recapture. [Receipt](round4/checks/replay.json).
- Focused tests, full repository tests and typecheck receipts are in round4/checks. The repository verification skill was unavailable; documented commands ran instead.

## What remains wrong

HelpCenter still has many layout/wrapper consequences, uncertain correspondences, content/registry differences, keycap duplicate style evidence and missing truncation evidence. Collection uncertainty reduces counts but costs recall. Tracks still produces layout-technique and wrapper findings on almost identical images; background-grid origin is not fully captured, and some off-screen causes lack strict bilateral evidence. Empty still has four unsupported candidates. Captured transforms, SVG path spellings and style-value ratios are heuristic causal evidence, not CSS declaration provenance.

Escaped absolute/fixed clips, explicit pan reachability and icon-only off-screen eligibility were not fixed in this pass; legacy captures cannot gain facts they never recorded. The product count remains advisory. **This round does not make the checker a trustworthy unique-bug counter.**

## Held-out

Rules froze at `168a0286ab75e9cf9aa603625da45be6cac04fe7` before label release. The orchestrator released labels at `57801875ac4290fed04fd9961429ee40af8f92b3`. The labels-only branch was merged, the checker source diff from the freeze was verified to be zero, and the frozen scorer ran **once**. [Freeze receipt](round4/checks/heldout-freeze.json), [manifest](round4/heldout-manifest.json), [full results](round4/heldout/summary.json).

| Held-out case | Strict TP / FP / FN | Strict precision / recall | R2 optimistic precision / recall | 60/60 target |
|---|---:|---:|---:|---|
| keycap-command-enter | 3 / 0 / 0 | 100.0 / 100.0 | 100.0 / 100.0 | MET |
| inbox-login | 7 / 1 / 0 | 87.5 / 100.0 | 87.5 / 100.0 | MET |
| inbox-waiting | 8 / 2 / 0 | 80.0 / 100.0 | 80.0 / 100.0 | MET |
| help-search-split | 4 / 37 / 9 | 9.8 / 30.8 | 17.1 / 53.8 | NOT MET |

Strict pooled: **35.5% precision / 71.0% recall**, TP/FP/FN = 22/40/9.

R2 optimistic pooled: **40.3% precision / 80.6% recall**, TP/FP/FN = 25/37/6.

The held-out target is **NOT MET**, whether assessed per case (HelpCenter fails) or pooled (precision fails). HelpCenter's strict misses include the absent search hint/results, the result-count placement, footer copy, command-name truncation, changed note copy and shared keycap styles. Its 37 unsupported candidates are mostly repeated layout (15), surface (6), ink (6), text alignment (4) and white-space (3), plus three other findings. Some shared-style labels have whole-tree wildcards that strict scoring deliberately rejects. These are reporting observations only; no second tuning pass followed. These four related components are not evidence of cross-product generalization. Help-search-split labels were independent of the checker, but **were not independently checked by a second labeller**; the reported agreement figure belongs to inbox-login, not HelpCenter. No rules, thresholds, matching, grouping, scorer or tests changed after freeze. No second score was run.

## Reproduce

```sh
pnpm exec tsx packages/proof/src/compare/round4-measure.ts .audit/a1-replay
pnpm exec tsx packages/proof/src/compare/round4-measure.ts .audit/a1-before --saved
pnpm exec tsx packages/proof/src/compare/round4-verify.ts .audit/a1-checks
pnpm exec tsx packages/proof/src/compare/measure.ts packages/proof/fixtures/design/tracks-pane.fdn.html .audit/a1-controls
pnpm exec vitest run packages/proof/src/compare
pnpm typecheck
```

## Attention

Reviewed by **claude-opus-5-5**, session `9a31f0fe-f8b6-41f2-8c15-7b37e87683c2`, against the decision trail and author transcript (not an independent source execution). It confirmed freeze-before-labels, one score, arithmetic and final checks. Its flags led to explicit post-label scorer history, reclassification counts, threshold/denominator warnings, changed-test disclosure and a longer retrospective trail. The initial claim that diagnosing-bugs was unread was withdrawn after locating the truncated transcript row.

Remaining attention: case-by-case tuning and changed strict vocabulary limit claims of generalisation; HelpCenter recall regressed; held-out HelpCenter fails both targets; test expectations changed with contracts. See [test changes and audit](round4-audit.md). Original controls were corrected and rerun before freeze; an interim claim of exactness had been premature. Controls/replay were not repeated after the last scorer/CSV-only edits, which do not participate in compare(); focused/full tests and typecheck did run after them. Capture recapture/replay was not established by this checker-only run.
