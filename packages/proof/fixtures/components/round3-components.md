# How accurate was the count on each component?

**Keycap finds all three labelled differences after a scoring correction but adds one false candidate. InboxRow and HelpCenter substantially over-count: HelpCenter reports 124 candidates against 21 hand-labelled causes, with only 13 supported.** These are candidate differences against the design, not confirmed implementation bugs. Real production exports were rendered, with independent hand labels made blind to reports. No matcher or grouping rule was tuned to these components.

## Count accuracy

One compatible raw drift is enough to support a multi-finding group. Scope matching is prefix-based: a label on 0/0 covers every descendant in that row. Either design OR code scope can earn credit; `layout` accepts any layout-kind drift. A bare `*` label scope matches the entire tree. HelpCenter H-17/H-18/H-19 use this permissive scope and account for three anchored supported candidates; the assigned evidence is the card or esc keycap, but the wildcard itself does not restrict it. A second true candidate for the same labelled cause counts as false under one-to-one assignment. “Supported” means maximum one-to-one assignment of candidates to hand-labelled causes with compatible raw properties and a matching design **or** code path scope. This is optimistic evidence support, not a second visual adjudication of each candidate. Uncertain groups are excluded from product precision; their missing labelled causes still count against recall. Environment labels are excluded.

| Component · state | Mode | Candidates | Hand labels | Supported | False candidates | Misses | Precision | Recall |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Keycap · default | ids | 4 | 3 | 3 | 1 | 0 | 75.0% | 100.0% |
| Keycap · default | no-ids | 4 | 3 | 3 | 1 | 0 | 75.0% | 100.0% |
| InboxRow · selected | ids | 16 | 7 | 5 | 11 | 2 | 31.2% | 71.4% |
| InboxRow · selected | no-ids | 16 | 7 | 5 | 11 | 2 | 31.2% | 71.4% |
| InboxRow · failed | ids | 17 | 6 | 4 | 13 | 2 | 23.5% | 66.7% |
| InboxRow · failed | no-ids | 18 | 6 | 4 | 14 | 2 | 22.2% | 66.7% |
| HelpCenter · agent-run | ids | 124 | 21 | 13 | 111 | 8 | 10.5% | 61.9% |
| HelpCenter · agent-run | no-ids | 119 | 21 | 12 | 107 | 9 | 10.1% | 57.1% |

Keycap has only three labelled differences, so its percentages have little statistical weight. InboxRow's two states share markup and do not count as independent components. HelpCenter has one fixture: agent-run context, initial shortcuts topic, no query.

## Layer correspondence

Only sure hand labels are scored. An abstention is a recall miss; precision excludes abstentions. “None” labels penalize a spurious pair. Correct correspondence does not imply correct independent-cause grouping.

| Component · state | Mode | Correct | Wrong | Missed | Precision | Recall | Unsure excluded |
|---|---|---:|---:|---:|---:|---:|---:|
| Keycap · default | ids | 1 | 0 | 0 | 100.0% | 100.0% | 0 |
| Keycap · default | no-ids | 1 | 0 | 0 | 100.0% | 100.0% | 0 |
| InboxRow · selected | ids | 6 | 0 | 1 | 100.0% | 85.7% | 0 |
| InboxRow · selected | no-ids | 5 | 1 | 2 | 83.3% | 71.4% | 0 |
| InboxRow · failed | ids | 8 | 0 | 1 | 100.0% | 88.9% | 0 |
| InboxRow · failed | no-ids | 7 | 1 | 2 | 87.5% | 77.8% | 0 |
| HelpCenter · agent-run | ids | 17 | 0 | 35 | 100.0% | 32.7% | 77 |
| HelpCenter · agent-run | no-ids | 16 | 0 | 36 | 100.0% | 30.8% | 77 |

Without ids, the InboxRow outer design row pairs with the capture wrapper instead of the real button (0 instead of 0/0). Three cheap fixture anchors per row improve correspondence partly by construction: they manually declare the known mapping. They do not repair the defect count; no-ids results are shown alongside.

## Scoring correction, kept separate from matching

The original frozen scorer required literal property equality: a `border-color` hand label did not credit `border-top-color` evidence. After the Keycap labels were seen, the orchestrator explicitly authorized a generic scorer correction, expanding border color/width/style, padding, margin, inset, gap, border-radius and font into their longhands. The matcher, tolerances, report candidates and grouping are unchanged. Original and corrected metrics are both saved in each `*-accuracy.json` as `strictDefects` and `defects`.

| Component · state | Mode | Supported before → after | Precision before → after | Recall before → after |
|---|---|---:|---:|---:|
| Keycap · default | ids | 2 → 3 | 50.0% → 75.0% | 66.7% → 100.0% |
| Keycap · default | no-ids | 2 → 3 | 50.0% → 75.0% | 66.7% → 100.0% |
| InboxRow · selected | ids | 5 → 5 | 31.2% → 31.2% | 71.4% → 71.4% |
| InboxRow · selected | no-ids | 5 → 5 | 31.2% → 31.2% | 71.4% → 71.4% |
| InboxRow · failed | ids | 4 → 4 | 23.5% → 23.5% | 66.7% → 66.7% |
| InboxRow · failed | no-ids | 4 → 4 | 22.2% → 22.2% | 66.7% → 66.7% |
| HelpCenter · agent-run | ids | 11 → 13 | 8.9% → 10.5% | 52.4% → 61.9% |
| HelpCenter · agent-run | no-ids | 10 → 12 | 8.4% → 10.1% | 47.6% → 57.1% |

Nine shorthand regressions failed before the fix; all ten cases pass after it, including a negative control. The same scorer was applied to all six frozen Tracks R2 reports. Only anchored empty changes: 10→11 supported out of 20, precision 50→55%, recall 71.4→78.6%. Anchored selected stays 10/24, proposal 11/24. Unanchored selected/proposal/empty stay 6/11, 6/11, 5/6. This replay uses saved R2 reports, not a claim that unanchored legacy captures equal current anchored captures. Full strict/corrected results: `evidence/tracks-shorthand-scores.json`.

## Runtime and uncertain groups

One measured run on netcup-2; milliseconds. Capture columns are per-side work after Vite startup, including diagnostic full-extent capture. Compare excludes Vite/browser startup. The full cold CLI took about 4.2 seconds for Keycap, 8.6 seconds for both Inbox states, 16.3 seconds for HelpCenter. These are observed runs, not budgets or statistical benchmarks.

| Component · state | Design capture ms | Code capture ms | Compare ms ids / no-ids | Uncertain groups ids / no-ids |
|---|---:|---:|---:|---:|
| Keycap · default | 1046 | 1466 | 17.3 / 11.7 | 0 / 0 |
| InboxRow · selected | 999 | 3540 | 32.2 / 16.0 | 1 / 2 |
| InboxRow · failed | 745 | 1170 | 40.0 / 14.1 | 1 / 2 |
| HelpCenter · agent-run | 2178 | 12059 | 848.6 / 885.6 | 31 / 39 |

## What was missed and what was over-counted

- **Keycap:** all three hand causes—height/box sizing, ink and border colour—have support after correction. The fourth candidate is authored font-family syntax despite identical pinned rendered mono faces. The initial score's missed border was a scorer vocabulary bug, not failed detection.
- **InboxRow selected:** the model-logo replacement and lower glyph alignment have no supported candidate. The checker produces many layout/configuration and authored font-stack groups without independent labelled causes. With ids, 11 of 16 candidates remain unsupported.
- **InboxRow failed:** the changed recovery note and lower glyph alignment are missed by one-to-one support. Thirteen of 17 anchored candidates are unsupported. These include repeated layout/configuration groups and authored mono-font syntax. The note can leave structural missing/extra evidence without satisfying a text cause; this is a grouping/evidence limitation, not proof that the code lacks the new note.

- **HelpCenter:** anchored support is 13/124 (10.5% precision, 61.9% recall); without ids it is 12/119 (10.1%, 57.1%). Misses include truncated command names, changed section header, changed topic copy, shortcut totals, anchor catalogue and focused-search border. Repeated layout and font-stack groups, plus 37 clipped-catalogue subtrees, inflate the candidate count. The hand baseline groups many changed catalogue rows into one cause, while the checker reports many local consequences. Label H-02 is explicitly partly fixture-derived because the fixture lacks production availability and plugin commands. Thus even the 21 product-labelled causes are not a pure production-app bug list. Of correspondence labels, 77 are unsure and excluded: sure-pair recall 32.7% with ids and 30.8% without is the useful warning beside 100% certain-pair precision.

See each accuracy JSON for exact candidate ids, assignments, false candidates and missed labels. The hand list includes likely intentional evolution; it is not a bug oracle.

## Harness effort and mocks

Apiary branch **`proto/design-to-code-components`**, final SHA **`4ece46a89966d9b4d3dedc585541ac2ca3d23e1c`**, from `ab8ab87d15f90af37caa6f28cb2a0253603e1d1f`. Production JSX/CSS changed **0 lines**. The fixture harness applies optional ids to real DOM after mount, reusing production rendering. Counts below are incremental source/fixture/config lines before the final shared manifest cleanup; JSON manifest/font-policy duplication is included, binary font assets reused unchanged.

| Component | Ladder rung | Added / removed | What is supplied or mocked |
|---|---:|---:|---|
| Keycap | 1 | 175 / 0 | children ⌘T; top alignment; 1 id; no service/provider/IO mock |
| InboxRow | 1 | 211 / 0 | selected completed and failed props; fixed age, name, message, priority/session records; entering=false; no-op ref/select/open callbacks; 3 ids per row; real model and activity helpers |
| HelpCenter | 2 | 671 / 0 | state import seam; real CommandRegistry with 59 source-derived defaults/no-op actions; real fresh WorkspaceStore settings and useRootVersion hook; context hive.agent-run; no-op close; 1 card id; real Popover/atlas/keybinding helpers |

The final shared manifest cleanup adds21/removes61 lines: primary `.foundation/links.json` keeps its valid Tracks artboard and indexes `componentManifests`; each executable per-board manifest binds its own design head. This is an unversioned inert index added under fdn-links/0, not an implemented schema feature. CI, policy and doctor do not discover these cases. Existing tools ignore the inventory metadata; use the explicit `--links` argument. Automatic multi-manifest discovery is not implemented. The final Apiary diff is `evidence/apiary.patch`.

HelpCenter does not reproduce production availability predicates or plugin contributions. The static extraction leaves two unresolved registrations (plugin forwarding and FocusTabAt indexed key); source locations and extraction result are committed. It is a finite registry fixture, not a complete shell command registry. No blanket undefined bridge is used; unexpected native accesses throw. Default-deny browser routes allow only local assets; committed capture metadata has no blocked requests or page errors.

## Capture bugs and boundary

Keycap uses design n203::n1 in row-grammar; InboxRow uses n249#1::n249::n17 and n249#0::n249::n17 in narrow-queue. HelpCenter uses n45 in dialog-agent-run. It is explicitly **card-only**: surrounding fake app chrome and the real Popover scrim are excluded. Its source auto-scroll to Agent run is preserved.

Both design and code roots are rewritten for boundary origins. A generic capture issue required an opt-in `--code-boundary` option: absolute design roots kept their original board offset when extracted. Moving a live card also reset its scroll, and initially assigning measured border-box width to a content-box root double-added borders. These were reported separately and corrected in capture code only: origins are normalized; focus is restored; existing box-sizing, measured dimensions and nested scroll offsets are preserved; an invariant rejects changed dimensions. Earlier HelpCenter capture commits are historical/superseded, not the final labelling target. The audited final receipt is `evidence/boundary-audit.json`: 281 design and 1801 code elements  × 54 properties, zero unexpected computed-style changes (only declared root position/margins); design extraction from its original ancestors changes zero properties. The code body scrollTop remains 2655 before extraction and after fonts/settling. This proves sampled style/scroll preservation, not arbitrary React reparenting safety. No design file or matcher was changed.

Pinned Chromium **151.0.7922.34**, Linux, DPR1, fixed Date/seed/UTC/en-US/light theme, frozen motion and bundled hashed font faces are shared. This deterministic Linux rendering does not establish Mac font fidelity or shipped Electron styling. Full-extent PNGs are diagnostic paint with overflow revealed and may reflow; normal screenshots/DOM are authoritative.

Fresh replay reproduced all eight design/code PNGs byte-for-byte and their node arrays exactly across all four cases, including corrected HelpCenter (`evidence/replay.json`); the earlier O1 refresh changed extent/provenance metadata. Small-case captures bind Apiary 5850046fe; final branch 4ece46a89 adds only the extraction helper/results and inert manifest index. Render fixtures/harness are byte-identical between them. Their pre-rebase rendererCommit 44174b7 is not a reachable Project ref, but the 54-file rendererSources hash binds their exact implementation; final Help capture binds 4b192f7 and Apiary 4ece46a89. After the Keycap/Inbox labels existed, O1 reviewed changes added one raw offscreen evidence row per Inbox state: anchored selected 42→43 and failed 44→45; no-ids 51→52 and 52→53. Candidate totals 16/17 (18 without ids for failed) are unchanged. The pre-label reports remain in commits 48009b4/7e6f966. Current reports are post-label replays, not the original frozen raw output. O1 is included without component-specific exclusions. Its off-screen candidates are included in product totals; unsupported clipped extra catalog rows are not silently ignored. Inbox overflow (54px content in a 49px frame) is detected but is counted as an unsupported candidate because one-to-one support already assigns the broader height and line-height cause to another group. Many layout false candidates are duplicated consequences of that single cause, not imaginary independent defects.

## Reproduce

Install both frozen lockfiles and Foundation's pinned Playwright Chromium. Clone the Apiary prototype branch above under any scratch directory. From Foundation:

```sh
pnpm exec tsx packages/proof/src/capture/cli.ts --code /path/to/apiary --links .foundation/links-keycap.json --design boards/system-help-center.fdn.html --out /tmp/keycap
pnpm exec tsx packages/proof/src/capture/cli.ts --code /path/to/apiary --links .foundation/links-inbox-row.json --design boards/inbox-unified.fdn.html --out /tmp/inbox-row
pnpm exec tsx packages/proof/src/capture/cli.ts --code /path/to/apiary --links .foundation/links-help-center.json --design boards/system-help-center.fdn.html --code-boundary '[data-help-center]' --out /tmp/help-center
pnpm exec tsx packages/proof/scripts/components.ts PAIR_DIRECTORY REPORT_DIRECTORY
pnpm exec tsx packages/proof/scripts/score-components.ts COMPONENT STATE PAIR_DIRECTORY REPORT_DIRECTORY
pnpm exec tsx packages/proof/scripts/score-tracks-shorthands.ts
```

The first script writes candidate reports/diff without loading labels; the second reads only committed reports and labels. Every pair directory contains design/code PNG, DOM and metadata. Each reports directory has `design-code-diff.png` in design | code | diff order. The standalone gallery is `index.html`.

Verification: 53 comparison/acceptance tests pass; Foundation typecheck passes; Apiary TS7 harness check passes through `node scripts/tsc7.cjs --noEmit -p .foundation/tsconfig.json`. Electron was not launched. No repository verification skill is installed in Foundation; Apiary core-work and verify-apiary were read, but no Electron integration claim is made.

The labeller session is f764521f-44e4-4b1d-9137-7d9c15700459, instructed to see capture directories only and no reports/counts. Capture commits preceded each received label. L1 explicitly confirmed it never opened reports/, drift-report.json, captures/index.html, candidate counts or code-repo links manifests; it used only capture PNG/DOM/meta, the design and Apiary source. Final Help labels are cae0e28ab9dde59564d2f6b9aec52dc6f8f3a517, checked against 50b24cf.

Studio Apiary collection failed (Landing Project T49). The orchestrator explicitly authorized the new Foundation prototype branch `proto/dtc-r3-components`; it contains the committed captures/report and will be collected onto the Project branch when service recovers. No force push or main push was made. The labeller branch diverged from the current source, so only its final ground-truth/help-center files were imported; the divergent old captures were not merged. Partial Project inputs/help-* base64 copies were an unused evidence-only fallback before the branch workaround, not authoritative captures.

Preview publication attempted with Nectar on netcup-2; failed `E_QUOTA`: serving web environment quota 12 reached. No live URL is claimed; the standalone gallery and primary screenshots remain committed.

Attention: reviewed by **claude-opus-5-5**, session **07ea5440-d019-4977-87b5-1a2577907658**, against ee329d9. Fifteen flags were raised and addressed; no medium or higher flags remain. The three residual low notes (wildcard scope, final log pointer, review status) are addressed here. The reviewer inspected committed evidence and imported labels; it did not run tests/replay or inspect the labeller transcript. The labeller separately gave an explicit blind-scope confirmation. Counts remain too imprecise for a reliable bug count.
