# Round 4 accuracy

**The overall target was not met. Keycap and both InboxRow states meet 70% precision and recall under strict support. HelpCenter and both populated Tracks states do not. Empty Tracks still has false positives. Held-out scoring is pending rule freeze and label release.**

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
- Seven normalized comparison reports and diff PNGs replay byte-identically. Timings and the timing-dependent reportHash are excluded from normalized report equality; full reports are not claimed byte-identical. Captures were read unchanged; this is a checker replay, not a fresh production recapture. [Receipt](round4/checks/replay.json).
- Focused tests, full repository tests and typecheck receipts are in round4/checks. The repository verification skill was unavailable; documented commands ran instead.

## What remains wrong

HelpCenter still has many layout/wrapper consequences, uncertain correspondences, content/registry differences, keycap duplicate style evidence and missing truncation evidence. Collection uncertainty reduces counts but costs recall. Tracks still produces layout-technique and wrapper findings on almost identical images; background-grid origin is not fully captured, and some off-screen causes lack strict bilateral evidence. Empty still has four unsupported candidates. Captured transforms, SVG path spellings and style-value ratios are heuristic causal evidence, not CSS declaration provenance.

Escaped absolute/fixed clips, explicit pan reachability and icon-only off-screen eligibility were not fixed in this pass; legacy captures cannot gain facts they never recorded. The product count remains advisory. **This round does not make the checker a trustworthy unique-bug counter.**

## Held-out

Pending: rules must be committed and recorded in decisions/A1.md before the orchestrator releases labels. The frozen held-out scorer refuses to overwrite an existing summary. No held-out labels have been read at this stage.

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

Cross-model decision-trail audit pending.
