# A1 decision-trail audit and test-contract changes

Reviewer: Claude Opus 5.5, session 9a31f0fe-f8b6-41f2-8c15-7b37e87683c2. It read Project research/A1-audit-input.md, plan-round4.md and the author's projected transcript through line 1858. It did not inspect another Cell, access labels or independently execute source. Its later correction withdrew the skill-read flag after locating the diagnosing-bugs read in a truncated transcript row.

## Findings reflected in the final report

1. **High: post-label scorer changes.** Position/offscreen and top/y, left/x were added after Tracks labels and misses had been inspected, briefly shared with optimistic support, then isolated to strict-only before freeze. The report now separates saved tuning evidence dependent on this vocabulary. Frozen R2 support retains the original shorthand vocabulary and permissive scope. Do not interpret extra strict credit as independently discovered defects.
2. **High: held-out failure must be per-case.** The report includes all four cases and pooled counts. HelpCenter-search fails precision and recall; pooled precision also fails. Pooled recall is not a claim that every held-out case passes.
3. **High: tuning is case by case.** Generic rules were derived from the named tuning misses. No component names or ids in implementation does not establish generalisation. Selected InboxRow is exactly at threshold; held-out precision shows the generalisation limit.
4. **Medium: changed tests.** All four changes are listed below. The second scrolling contract was separately communicated to the orchestrator after the audit.
5. **Medium: reclassification affects precision.** Per-case product, uncertain and environment counts now appear before/after. Uncertain candidates leave precision but labelled misses remain in recall. HelpCenter strict recall regresses.
6. **Withdrawn: skill was not read.** The reviewer located the read and withdrew this finding. The report still narrows the claim to consulted because the full diagnosing-bugs hypothesis loop was not performed.
7. **Medium: thin trail.** Retrospective rows now record the meaningful rule/scorer changes and metric checkpoints. They are marked retrospective, not presented as contemporaneous. Earlier pending rows remain append-only, followed by corrections.
8. **Low: replay scope.** The final claim is deterministic normalised checker replay: two compare() calls in one process, on stored captures, excluding timings and the dependent reportHash. It is not a fresh production recapture. Scorer/CSV-only edits followed the final controls/replay, with focused/full tests and typecheck afterward; compare() does not call the scorer.
9. **Low: premature interim controls claim.** Controls initially regressed under new SVG/below-fold rules and were corrected before freeze. Final exactness is supported; the interim assertion was premature.
10. **Low: small denominators and HelpCenter regression.** Counts now accompany percentages; HelpCenter recall regression is in the opening paragraph.

## Changed existing tests, not just added tests

- Offscreen “new control in an intentional scroller” changed from one finding to zero. Rationale: in-frame functioning scrolling makes new content reachable. This was announced and approved by the orchestrator; it is not one of the original fourteen controls.
- Offscreen “code scroll overflow when design content fits” changed from one finding to zero and was renamed. Rationale: displacement remains layout drift, but reachable scrolling is not independently a visibility defect. This broader contract was described in the final draft, and separately announced to the orchestrator after the audit. It is not one of the original fourteen controls.
- The round-two region test changed from one group containing structure and geometry to two groups. Rationale: the task explicitly calls out region merging hiding independent causes. Structural missing/extra evidence stays together; independent geometry no longer disappears into it. The old assertion failed under the new rule, and was updated intentionally.
- The new inert-SVG regression fixture first used empty group attributes, then changed to a data-fdn-id-only group when the fourteen controls caught false icon findings from authoring metadata. Empty groups passed before that fixture change; the final test covers the metadata case rather than retaining both variants. No tests were changed after freeze.

## Remaining attention

The overall target is not met. Reclassification and post-label scorer changes must not be mistaken for a calibrated bug count. Saved evidence and the frozen commit permit independent checks; no held-out result caused a rule change. The report is an honest failed-target result with some useful component improvements.

Retrospective trail evidence uses source filenames as shorthand beneath `packages/proof/src/compare/`. `author-transcript:L…` refers to the projected transcript of ff2c73ed-45e6-484e-a18c-21f64fcad0ab inspected by the reviewer; these are review pointers, not local files. Retrospective entries explicitly distinguish checkpoints from isolated effect estimates. Unmeasured changes are not assigned invented metric deltas.
