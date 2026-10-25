# Round 2: accepted differences and prototype CI

The code repository can run an engine-free design check in GitHub Actions, keep a reviewed exception for an intentional difference, and reject that exception when the design, measured code value, component, subtree or captured pixels change. Advisory success means the check ran and published evidence; it does **not** mean the design matches.

## Adoption

1. Link the real component, fixture, viewport and state in the code repo's `.foundation/links.json`. Supply the deterministic harness and pinned fonts described in `research/renderable-contract.md`. Do not use a replica component.
2. In Foundation, render the reviewed design once. Commit the design `dom.json`, `meta.json` and `screenshot.png` under the code repo's `.foundation/baseline/`. Bind `designHead` and `designHtmlSha256` in the links. A new design revision needs a regenerated, reviewed baseline.
3. Build the CLI with `node packages/proof/scripts/package.mjs OUTPUT_DIRECTORY`. It runs `pnpm pack` on an engine-free package, includes a dependency shrinkwrap and source/input/binary fingerprints, and refuses dirty proof sources. Commit the versioned tarball under `.foundation/vendor/`.
4. Review `.foundation/proof-policy.json`: required captures, tolerances, browser/font environment, each complete baseline capture hash, design HTML/head, permitted environment causes and tool package/binary hashes. The running workflow reads policy **and tool** from a fixed previously reviewed base commit, never the candidate's policy file. After reviewing a new base policy, update the workflow's full `POLICY_REF`.
5. Start advisory. Review each state's summary, uncertain candidates and images. To keep an intentional difference, run `foundation-proof accept DEFECT_ID --report REPORT --reason REASON --reviewer REVIEWER --file .foundation/accepted.json`, commit the list through review, then regenerate the proof. The installed final CLI reproduces the committed demo entry exactly.
6. Resolve drift and missing renderable states before requiring the check. This prototype intentionally supports only its prototype branch. Production adoption needs a trusted `pull_request` workflow, a required status, and CODEOWNERS/rulesets covering workflows, `.foundation/**`, linked fixtures/mocks and relevant component paths. A reviewer string does not authenticate approval.

## Why the workflow runs in Apiary

The original task placed Actions in Foundation with a pinned private Apiary checkout. `gh secret list -R honeybeehq/foundation` was empty, and Apiary is private. On 2026-10-25 the orchestrator directed execution into the code repo instead. Its own read-only `GITHUB_TOKEN` checks out the exact candidate SHA. Foundation supplies the design baseline; the installable tool captures only code, compares, accepts and verifies. No Foundation engine is bundled into Apiary, no repository secret was added, and existing Apiary workflows were unchanged. A cross-repo private checkout remains an optional deployment choice requiring an owner-provided read token.

Only `proto/design-to-code-tracks` can run this workflow: push is restricted to that branch and a job-level ref guard also covers dispatch. There is no main trigger and no paths filter that would miss changes to shared components, tokens or lockfiles. The matching Foundation workflow is kept as the runnable template under `packages/proof/src/report/workflow.example.yml`; it is deliberately not enabled on Foundation main.

## Accepted-list rules

Schema `fdn-accepted/0` has `entries[]`. Each entry binds a stable R2 defect id; exact artboard/state/viewport; design/code layer ids or DOM paths; kind and all constituent property values; linked component export; reason, reviewer and date; design HTML SHA256 and chain head; and a code-pixel fingerprint covering the accepted bounds. Missing/extra entries also bind the full present-side subtree contents. Raw sequential finding ids are excluded from the value snapshot, so unrelated finding insertion does not expire an entry.

Unknown ids/scopes, malformed or duplicate entries, changed layer/kind/member values, changed component, changed subtree contents or pixels all fail verification. A changed design gives exactly: **“design changed since this difference was accepted; re-review or update the design”**. Reports embed the complete list plus its canonical SHA256, preserve raw drifts, and annotate accepted defects separately. Verification replays measurements, fingerprints and acceptance; editing a list without regenerating the proof fails its binding.

Pixel differences outside the union of accepted design/code boxes still meet the normal tolerance. Pixels inside those bounds are fingerprinted exactly, so an image/canvas/SVG edit invisible to DOM measurements also expires acceptance. The summary shows excluded area and residual difference. There is no excluded-area cap: a reviewer must inspect broad container acceptances. Exact pixel bindings intentionally fail closed on a browser/font/rendering change; use the pinned environment. Uncertain candidates cannot be accepted. Environment groups require an explicit trusted cause allowlist; this policy allows only `declared-linux-font-substitution` and shows allowlisted versus unreviewed groups separately.

The single demo accepts Classic's concise empty-pane explanation rather than the longer editorial paragraph. It is explicitly reviewed by **R3 prototype review (Codex)**, with product review required before adoption; it is not Tormod approval. All other candidates remain unresolved. The stale demonstration uses the real downloaded Actions artifact, deliberately edits the accepted design head, executes verify and restores the file. Its dirty-checkout and list-hash errors are expected additional defenses, not hidden failures. This is a deliberately stale input, not an invented historical approval.

## Source, policy and interpretation

Final package: `foundation-proof@0.2.0-proto.4`, Foundation source `1b9664585dd8c53f667063dcdbf94604cf28742d` on `proto/fdn-proof-ci-ready`, including frozen R2 matcher `e419831`. Package SHA256: `63ae61751e88f67a124e12a72d26516a0a460e1dbbff579114927434a3347811`; installed CLI SHA256: `5d465bdeb3c344b9fcf65ab4e45afbd36443d052b52d308be2f62c69cf925eb7`. Reviewed code-repo policy base: `5cb1e7e5aeb4e92af7c0595b5408558e82bb774b`; captured Apiary candidate: `ab8ab87d15f90af37caa6f28cb2a0253603e1d1f`.

The workflow hashes the downloaded tarball and installed binary. It caches app node_modules and pinned Chromium under the lockfile/tool key; it does not cache the tool installation. Local `--tool-hash` metadata is self-asserted; CI's measured checks establish that binding. Per-input source digests identify bundled sources, not the cleanliness of unrelated Foundation files.

R2's final product **candidate** counts are 24/24/20 for selected/proposal/empty, compared with 31/35/14 independently hand-labelled product defects. Label agreement is 10/11/10; recall remains low. There are 18/18/0 uncertain groups and one environment group per state. These are candidate causes, not confirmed unique real bugs. CI does not fix the matching-quality limitation by accepting the noise. The at-rest state is explicitly not provable because Classic auto-selects a track. Required mode therefore cannot turn green until that state is truly renderable (or a reviewed scope decision changes required coverage).

## Independent review and checks

Claude Opus 5.5 reviewed the source, package fingerprints and actual Actions logs, without claiming to execute our tests. Review found and drove fixes for a global pixel waiver, missing subtree snapshots, unpinned pixels inside accepted bounds, absent tool provenance and broad environment exemptions. Its final review found no blocking issue for the honestly scoped advisory prototype. Remaining limits are candidate recall, exact-environment pixel binding, broad accepted-area judgment and the unprotected prototype trust boundary.

Local checks: `pnpm typecheck`; 30 focused tests across acceptance, environment and R2 grouping/matching, including unrelated pixel drift, same-box subtree edits and invisible DOM pixel edits. Real Actions captures and verifier output provide the execution evidence. No repository verification skill or AGENTS.md was present; no unavailable skill is claimed to have run.

## Real Actions runs and timings

All final runs below install tool **0.2.0-proto.4** and capture the exact Apiary candidate above. Both tarball and installed binary hash checks passed.

| Run | Mode and result | Run elapsed | Job time | Install | Capture | Cache |
|---|---|---:|---:|---:|---:|---|
| [40182358445](https://github.com/honeybeehq/apiary/actions/runs/40182358445) | advisory job green; verification false as expected | 112s | 108s | 51s | 15s | cold/miss |
| [40182524513](https://github.com/honeybeehq/apiary/actions/runs/40182524513) | advisory job green; verification false as expected | 91s | 87s | 24s | 14s | warm/hit |
| [40182357998](https://github.com/honeybeehq/apiary/actions/runs/40182357998) | required job red; drift + incomplete coverage | 96s | 92s | 47s | 16s | concurrent cold |

For the exact final tool, caching cut install time from 51s to 24s (27s, about53%); total run elapsed fell from112s to91s. Browser and app node_modules restored successfully; tool installation remained fresh.

Earlier tool2 measured a warm reduction from 55s to 18s install ([cold107s](https://github.com/honeybeehq/apiary/actions/runs/40181828750), [warm82s](https://github.com/honeybeehq/apiary/actions/runs/40181980498)); those runs establish timing history, not the final matcher or pixel-inside-bounds fix. Tool1's earlier green/red runs are also superseded. Run elapsed includes queue/setup; job time is the job API's started_at to completed_at. Capture time fluctuates independently of dependency caching; these are observations, not a latency guarantee.

Each run uploads code captures, design replay captures, side-by-side source images, diff images, sealed per-state reports and manifest, verification.json, and the Markdown job summary. The summary leads with counts and the accepted reason, keeps full candidate tables in expandable state sections, names not-provable reasons, links the image artifact, and displays accepted bounds/residual pixels and allowlisted environment groups.

The final cold report has selected/proposal/empty residual differences of 2.805%/3.232%/0.881% against 0.1%. The empty acceptance excludes 3.855% of the image and pins those code pixels exactly. Its other 19 product candidate groups remain unresolved. This demonstrates a usable advisory workflow and a failing closed required mode; it does not demonstrate design equality.

To check stale behavior locally, download the run artifact, then run `pnpm exec tsx packages/proof/src/accept/verify-demo.ts MANIFEST APIARY_REPO TRUSTED_POLICY OUTPUT_DIR`. It first records a real accepted difference, temporarily stales the design head, records the clear failure, and restores the list in a finally block. Committed output is under `packages/proof/src/accept/evidence/`.

Proof images render the actual downloaded final cold summary.md with an explicit source/run banner. The native GitHub sidecar returned browser-unavailable (no mounted sidecar), so the screenshot is not claimed to show GitHub browser chrome. A Nectar preview provides the same full summary and captured image links.

Live final summary preview: https://trmd-metal-2.tailff9529.ts.net:8467, Nectar reference `nectar://trmd-metal-2/fdn-r3-ci-summary--proto-fdn-proof-ci-ready--web`. Earlier summary preview was stopped to free its own quota slot.
