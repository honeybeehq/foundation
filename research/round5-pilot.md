# Limited pilot: manual review works; accuracy target missed

The advisory pilot ran on five real components in six states. After reviewing the first run, a deliberate Keycap opacity change produced exactly one new unreviewed item; the other thirty decisions carried forward. Reviewing that item and running again left no unreviewed **product candidates**. This demonstrates the workflow, not design equality: verification remained false in all three runs, and the frozen accuracy pass missed the 70% precision / 70% recall target on both new positive cases.

## Scope and setup

| Component | States | Screenshot viewport |
|---|---|---|
| Keycap | default | 160×60 @1 |
| InboxRow | selected, failed | 340×100 @1 |
| Button | retry fresh / default | 240×80 @1 |
| SectionLabel | default | 240×60 @1 |
| StatusDot | running | 100×60 @1 |

Apiary branch **proto/fdn-pilot** was created from P2's component fixture commit `d336dbb8880dd817d55476a408d1ee0b996c57e1`. Later big-panel fixture changes on the shared component branch were not merged into this pilot. The workflow `.github/workflows/foundation-pilot.yml` runs only on this prototype branch, including a dispatch ref guard. It has no required-mode input, required check configuration or release-enforcement step. Main, existing workflows, repository secrets and approved R3 refs were not changed.

Keycap and InboxRow retain their authoritative legacy design captures. The three new design baselines come from P2's final `3541229dfa34b6eac438079a056d22536202e532`, captured with source `8f60686` after its viewport audit. The whole design board was laid out at 1600×1200 before clipping the small specimen image. Tentative `04a13c1` captures were not used. The engine-free code-capture behavior is unchanged since P2's `37ba01b`; both context fixes were integrated before packaging. Baselines are committed per component/state/viewport under `.foundation/pilot-baseline/`, with their original metadata, DOM and PNG. Each new complete capture hash was independently checked against P2's released value.

The installed tool is **foundation-proof@0.3.0-pilot.3**, built from Foundation `0087d692bba2e70e0b44febfa47e76e451ba4e34`. The comparator, grouping and scorer files have no diff from the A1 freeze `168a0286`. No rules were changed after labels were released. The CLI is engine-free; Foundation's design renderer is not bundled into Apiary. The tarball includes a shrinkwrap and source/input/binary fingerprints.

The reviewed policy base is Apiary `05339f65546213fa5246a289d94ff8c81201334e`. CI reads policy **and tool** from that immutable prior commit using `git show`, checks the tarball SHA256 and the installed CLI SHA256, then captures the candidate at its exact event SHA. The policy binds every scope's HTML digest, chain head, full baseline capture hash, link-file bytes and browser/font environment. Output paths include component, state **and viewport**, so repeated `default` names cannot overwrite one another.

- Vendored package SHA256: `f11f5c08baff44ba3362e30c997dad123a5e48a500f323704f7808ec0a7f9098`.
- Installed CLI SHA256: `20e906cd45a444187dac6458c9059e6e8b4e50641490f4184e7f8ecce42827d1`.

The independent checker rebuilt the same CLI hash. It did **not** reproduce the tarball bytes; the tarball is a pinned artifact, not a reproducible-build claim.

## Actual Actions runs

All capture, comparison and upload steps finished successfully. Every run's verifier returned `passed:false`, with drift errors in the six scopes and no tool, capture-hash, binding or environment validation errors. Green means advisory execution completed, not that the components match.

| Run | Candidate commit | Job result | Job time | Install | Capture | Product review state |
|---|---|---|---:|---:|---:|---|
| [Initial 40469303506](https://github.com/honeybeehq/apiary/actions/runs/40469303506) | `77eeff36b` | advisory success | 113s | 58s | 19s | 30 unreviewed |
| [Deliberate drift 40470241574](https://github.com/honeybeehq/apiary/actions/runs/40470241574) | `91bdbe0cc` | advisory success | 97s | 30s | 21s | **1 new unreviewed; 30 carried** |
| [Reviewed follow-up 40470779019](https://github.com/honeybeehq/apiary/actions/runs/40470779019) | `69a1e0b8d` | advisory success | 98s | 34s | 20s | **0 unreviewed; 31 carried** |

Job times are GitHub's job `started_at`→`completed_at`, excluding queue time. App node_modules and the pinned browser are cached; tool installation is fresh and binary-hash checked. These observations are not latency guarantees. The initial workflow had `continue-on-error` on the comparison step, but its log confirms the check exited normally with the advisory warning. That setting was removed before the second run so unexpected check failures are visible. None of these optional prototype jobs automatically block a release.

The positive control adds only `opacity: 0.86` to the real shared Keycap style, with an explicit prototype comment. The new candidate is `keycap/default/160x60@1::def-d6c2e901aaf6620b9df4`, measuring opacity `1`→`0.86`. It remains on the prototype branch for inspection and must be removed before adopting that branch as product code.

Each artifact contains paired/replay captures, source and diff images, sealed reports/manifest, verification.json, summary.md, review-index.json and review-status.json. The summary lists stable scoped ids, measured values, image-artifact links and prior decisions/notes. Environment and uncertain groups remain visible separately and are not counted in product verdict frequencies. StatusDot still has a retained non-product finding and a drift verdict despite zero product candidates; “all reviewed” does not mean that every environmental difference is resolved.

## Reviewer workflow

Download the artifact and install its exact vendor CLI **before** starting the timer. Keep `review-index.json` beside its relative component report directories. From a Node24 environment, for example:

```sh
npm install --prefix /tmp/fdn-pilot-tool /path/to/apiary/.foundation/vendor/foundation-proof-0.3.0-pilot.3.tgz --ignore-scripts
node /tmp/fdn-pilot-tool/node_modules/foundation-proof/cli.mjs review-start /path/to/artifact/proof/review-index.json --code /path/to/apiary --reviewer 'Reviewer name'
node /tmp/fdn-pilot-tool/node_modules/foundation-proof/cli.mjs review /path/to/artifact/proof/review-index.json 'keycap/default/160x60@1::def-d6c2e901aaf6620b9df4' real --note 'Opacity differs visibly' --code /path/to/apiary
node /tmp/fdn-pilot-tool/node_modules/foundation-proof/cli.mjs review-end /path/to/artifact/proof/review-index.json --code /path/to/apiary
```

The tiny decision command is `review RUN DEFECT_ID real|accept|false --note ...`. A numeric run reference resolves `.foundation/review-runs/RUN/review-index.json`; the artifact directory is gitignored. CI uses `RUN_ID.RUN_ATTEMPT` so reruns have distinct review sessions. Unqualified defect ids work only when unique; scoped ids include component/state/viewport.

`.foundation/review-log.json` uses `fdn-review-log/0`: entries record the scoped id, measured-claim fingerprint, decision, note, reviewer, source run, timestamp and session id. Real/false reviews bind the design revision, component, layers, kind/cause and constituent measured values, not an unrelated code commit or property. Missing/extra reviews also bind their subtree facts. A changed claim reopens review. Accept writes an actual `fdn-accepted/0` entry and additionally requires the strict component/design/value/subtree/pixel binding to remain valid. A valid pre-existing acceptance is acknowledged separately from pilot verdict frequencies. Failed log persistence rolls an acceptance back. Re-deciding a prior acceptance as real/false removes its exemption.

False-alarm review does not delete raw measurements, change tolerances, tune rules or make verification pass. “Real” here records a visible discrepancy, not fault attribution, a confirmed unique code bug or an instruction to auto-fix. The one accept demo retains the InboxRow fixture's generic runtime-failure text instead of the board's tmux-specific sample. It is explicitly **agent review of a fixture mismatch**, illustrating the acceptance mechanism—not an intended product decision or Tormod approval. Matching the fixture to the design is the proper adoption step; the demo exemption should not be carried into production as product intent.

## Measured review time and verdicts

| Reviewed run | Ended session wall time | Timed actions | Real | Accept demo | False alarm |
|---|---:|---:|---:|---:|---:|
| Initial | **213.999s** | 30 | 24 | 1 | 5 |
| New-opacity item | **52.290s** | 1 | 1 | 0 | 0 |

These are **agent-assisted wall-time observations**, not human-speed benchmarks. Setup, download and gallery generation were completed before review-start. The first session inspected six image pairs and all measured claims before batch-entering decisions: its first action interval is196.040s and later intervals are about0.6s. Those intervals are not individual inspection times; only the session total is meaningful. The second session inspected the changed pixels and opacity values before marking the new item real through the installed CLI. The follow-up summary carries both ended-session times forward. No new timed manual session was started for the zero-unreviewed follow-up; that is not a measured zero-second review.

Only one session may be active across runs. Review-abort with a note closes an orphaned session; aborted time is excluded and retained decisions are marked untimed in metrics. Runs with only aborted sessions have no timing-table row; repeated decisions count as additional actions, not new unique defects. This demo used neither aborted sessions nor pre-existing accepts.

## Frozen blind accuracy pass — no tuning

At the orchestrator's request, the three new cases were scored **once** after the independently frozen labels `0a726d99fae93a7bf4928b7e41be2ccca9d31a1a` were released. The pass uses the immutable **initial** CI reports, not the opacity-control run and not the manual review labels. Input report/label SHA256 values and exact output are in `round5-pilot/accuracy/`. The scorer and matching files have zero diff from `168a0286`; no changes followed the score.

| New case | Strict TP/FP/FN | Strict precision / recall | Optimistic TP/FP/FN | Optimistic precision / recall |
|---|---|---|---|---|
| Button retry | 2 / 6 / 3 | **25% / 40%** | 4 / 4 / 1 | **50% / 80%** |
| SectionLabel | 1 / 1 / 2 | **50% / 33.3%** | 1 / 1 / 2 | **50% / 33.3%** |
| StatusDot | 0 / 0 / 0 | **not defined** | 0 / 0 / 0 | **not defined** |

Both positive cases miss the per-case70/70 target. StatusDot has no labelled product defect and no product prediction; it is not a100% detection result. Micro totals across the three are strict3/7/5 (30% precision,37.5% recall), optimistic5/5/3 (50%,62.5%).

Strict scope requires both sides' labelled layer scope; optimistic support allows either side. Some Button font/ink claims occur at a parent rather than the labelled text leaf, so optimistic support is higher. The0.5px font-size difference and0.2px label-tracking difference are below the frozen1px style tolerance. SectionLabel's authored-font difference is classified as environment rather than a product candidate. The literal-uppercase versus CSS-uppercase candidate is a false positive. These are measured limitations, not rules to change after seeing this test.

The scorer driver refuses to overwrite an existing score directory. Its input receipt's sourceCommit identifies the loaded frozen code revision; the driver was added to the final P1 changeset after the execution. A checker can reproduce from the recorded initial artifact, released labels and frozen source in a separate output directory. Manual pilot verdicts are not substituted for blind accuracy labels.

## What a team still needs

Keep this as a limited, manually reviewed advisory pilot. Fix or explicitly scope the accuracy misses before considering any automated enforcement. Choose matching fixture data, design ownership, reviewer identities and normal code review of baselines/links/fixtures/review log/accepted list. Reviewer names and timings are ordinary repository audit fields, not authenticated signatures. A candidate-controlled workflow can change its policy reference; this prototype is not an adversarial trusted PR gate. No secrets or protection rules were installed.

The independent cross-model reviewer checked source, tests, actual Actions logs/artifacts, hash bindings, carry-forward and timing. It confirmed the workflow observations while retaining the advisory/measurement limitations. Approved older Cell branches/refs were preserved throughout; no reset, branch deletion or git gc was used.
