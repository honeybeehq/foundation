# Off-screen detection: the missed proposal controls are now found

The detector finds the real Classic Tracks proposal action bar once, as `layout` / `offscreen` / `product`: **“rendered outside the visible pane: … Accept … Refine … Discard …”**. Its measured box is **[566, 1023.40625, 480, 44]**, outside the **1416×611** pane and **1416×720** screenshot. The diagnostic image reaches **1416×1150** and shows the bar below the frame. [Annotated screenshot](offscreen-evidence/proposal-annotated.png), [full diagnostic capture](offscreen-evidence/captures/tracks-pane/proposal-pending/1416x720@1/code/full-extent.png).

The old list design also flags intentional clipped Flow View content. It cannot establish the requested zero new selected-state false positives: its corresponding labels are inside the frame. The orchestrator agreed to preserve and explain these candidates, with no content-specific ignores, and evaluate U1's clipping-aware design separately. U1's first Flow View baseline, collected as `f9dfd62`, exempts all graph-card subtrees. It adds selected1/proposal2/empty0: the bar plus two copy blocks whose direct text/tag differ from code. The selected design line is truncated, and the proposal note has a different tag/trailing period. U1 is aligning these intended copy blocks before the final comparison; no fuzzy matching or content-specific detector ignore is added.

## Measured old-design results

| State | Existing product candidates | With detector | Added subtrees |
|---|---:|---:|---:|
| selected | 24 | 28 | 4 graph/copy subtrees |
| proposal-pending | 24 | 30 | 5 graph/copy subtrees + 1 proposal action bar |
| empty | 20 | 20 | 0 |

[Complete results and boxes](offscreen-evidence/results.json). The paired `*-before.json` and `*-after.json` files contain the full defect lists. Existing R2 matches and raw findings stay an exact prefix; the independent detector appends one raw `layout` measurement per new defect. It never changes R2 matching or grouping. Existing unique-cause count limitations remain; these totals are product **candidates**, not confirmed unique real bugs.

Selected's four new candidates are Fix findings, Publish preview, Ship it?, and the up-next copy. Proposal adds the clipped instruction, removed Manual smoke test, proposed Publish preview, Ship it?, and proposal explanation, plus the controls. The graph/copy groups are intentional-layout candidates against a stale design, not newly adjudicated bugs. The whole action bar counts once despite its three buttons, text, and shortcut descendants.

## Capture and comparison contract

After settle, `collectDom` records every rendered element's root-relative box and whether it has direct text or is interactive, its clipping ancestor boxes/axes, native scroll overflow, and conservative pan evidence. The root's scroll extent, frame and root-relative browser viewport are persisted in capture metadata. The detector checks both frame and viewport plus ancestor clips with a 1px tolerance. Hidden/transparent subtrees are ineligible.

A clipped item is exempt only when an identifiable design counterpart is itself outside/clipped. Identity uses a unique id, unique text/tag, unchanged path/box/content, or a certain existing match. Native scrolling additionally requires a corresponding scroll ancestor and the same overflow axes. An extra code item in an otherwise intentional scroller is still reported. An overflowing container alone never excuses new hidden controls. Equivalent clipped graph content is exempt through its design counterpart; captured `pan` is diagnostic evidence only, not a blanket exemption.

A wholly affected subtree whose own box is outside/clipped counts once. An in-frame common ancestor cannot swallow independent clipped siblings. Repeated ids fall back to paths and the defect hash includes the root path. DOM insertions can therefore stale an id safely.

Each new defect has a raw finding containing its box, frame, viewport, clip chain, element paths and label summary in `drift.code`. Acceptance values bind those measured facts; tests show geometry, clipping and label edits go stale. Off-screen pixel crops contain approximately zero pixels, so this is measured-evidence binding, not pixel coverage. Style-only invisible changes are not bound.

`full-extent.png` is **diagnostic paint**, captured after the original screenshot and DOM with overflow temporarily revealed. It can reflow contents and is not a picture of the unmodified paint. Styles and scroll positions are restored; restoration is tested. Its SHA256 is recorded in `meta.fullExtent`. Diagnostic failure currently fails capture. Window-scrolled fixtures and arbitrary clipping shapes are outside this proof.

## Controls and repeatable checks

All **43 focused tests pass**, including 13 real-browser off-screen cases and acceptance, environment and frozen-R2 regressions. The original 14 mutation cases were rerun with the script from Foundation baseline `04b1c9e`, then with the shared collector. Their normalized rows are **byte-identical**, including expected/found, tp/fp/fn, precision/recall and pixelRatio; only elapsed time and new detector fields are excluded. [Equality receipt](offscreen-evidence/controlled-equality.json), [baseline rows](offscreen-evidence/baseline14.json), [current rows](offscreen-evidence/current14.json).

The added case translates an actual design heading down 1000px: **1 expected off-screen subtree, 1 detected, 0 detector false positives/misses**. Its raw matcher consequence is recorded separately under `otherDrifts` rather than hidden. [15-case output](offscreen-evidence/controlled15.json), [full new-case report](offscreen-evidence/controlled-offscreen-report.json).

```sh
pnpm typecheck
pnpm exec vitest run packages/proof/src/compare/offscreen.test.ts packages/proof/src/compare/round2.test.ts packages/proof/src/compare/environment.test.ts packages/proof/src/accept/accept.test.ts
pnpm exec tsx packages/proof/src/compare/offscreen-real.ts research/offscreen-evidence/captures /tmp/offscreen-replay
pnpm exec tsx packages/proof/src/compare/measure.ts boards/tracks-pane.fdn.html /tmp/offscreen-controls
pnpm exec tsx packages/proof/src/compare/offscreen-controls.ts research/offscreen-evidence/baseline-controlled/measurements.json /tmp/offscreen-controls/measurements.json /tmp/offscreen-parity
```

Full pair discovery is generic; it does not assume a Tracks state list or viewport directory. At-rest remains not provable and is excluded from product claims.

## Limits and independent review

**Legacy gates gain no off-screen coverage.** Captures without visibility facts retain their legacy verdict compatibility, with `report.offscreen.status: unavailable` and the named `offscreen-unavailable` reason. This warning is currently JSON-only: report summaries and gate consumers do not read it. Every O1 detection claim uses fresh recaptured pairs with complete visibility facts. Old-capture fallback viewport assumes a root at (0,0).

The cheap ancestor-box model can over-report absolute/fixed children that escape a non-containing overflow ancestor. It does not handle arbitrary clip-paths, shadow DOM, text ink beyond its element box, or non-interactive images/icons. More data rows than the design can produce one candidate per affected subtree; this is not semantic region/cause inference. Pan evidence is recorded but does not prove interaction reachability. These limits are disclosed instead of broadening the task into a browser paint/interaction engine.

Reviewer **claude-opus-5-5** (session `683114b2-80fa-4ae4-b594-7e96c6066a41`) independently reviewed the diff and trail, then narrowly verified the fixes. It did not execute tests. High acceptance/duplicate-id/coverage issues and medium viewport/path issues were fixed; its remaining limitations above are explicit. The original detector commits `e9d3475`, `9975265`, `1c1c2fc` were collected/rebased as the project tip `ffd2bbc`. Old-design captures bind to clean pre-rebase capture source `1c1c2fc`; compare/offscreen-real and all 43 tests were replayed on collected head `f9dfd62`. C added an optional boundary extraction branch to the capture CLI, so these are not described as captures produced by `f9dfd62`. The U1 recapture was produced by `f9dfd62`; Apiary is clean read-only scratch clone at `ab8ab87d15f90af37caa6f28cb2a0253603e1d1f`.

No AGENTS.md or repository verification skill was present. astack-principles and show-me-your-work were available and used; package checks provide the verification evidence. [Decision trail](offscreen-evidence/decisions.tsv).
