# Prototype CI in the code repository

`node packages/proof/scripts/package.mjs OUT_DIRECTORY` bundles only capture,
compare, accept and report code, checks that no engine source entered the
bundle, and runs `pnpm pack`. Install the resulting versioned tarball with npm.
The package pins Playwright 1.62.0 (Chromium 151.0.7922.34), pixelmatch and pngjs.
No Foundation renderer is installed into Apiary.

Foundation renders and reviews the design baseline first. The code repository
commits `.foundation/baseline/` paired with `links.json`'s `designHead` and
`designHtmlSha256`. The trusted policy pins each complete design capture hash
(DOM, metadata and screenshot), those design bindings, capture requirements,
tolerances, browser/fonts, and the CLI tarball SHA256.

`workflow.example.yml` is the real prototype workflow copied from Apiary. It is
installed only on `proto/design-to-code-tracks`, with a job-level branch guard
also covering workflow_dispatch. It checks out the exact event commit, loads
policy **and tool** from a fixed previously reviewed base commit, installs frozen
app dependencies, captures the actual Classic components, compares and verifies,
uploads all captures/reports/images, then writes the summary. The base SHA is
changed only after review. A candidate change to its policy JSON or vendor file
cannot loosen the current run. GitHub branch protection/review must also protect
workflow edits before treating this as an adversarial required PR check.

The push mode is advisory: measured drift and not-provable states warn and exit
zero; setup/capture failures still fail. Dispatch with mode `required` exits one
for drift, stale acceptance, or incomplete coverage. At-rest remains explicitly
not provable because Classic auto-selects a track. Never count this as passing
coverage. node_modules and the pinned browser are cached under the app lockfile
and tool SHA. Install/capture/total timings and cache status are in the summary.

The baseline and code renderer have separate source fingerprints. A baseline
pair may compare portable font/browser policy only when the code capture names
the exact design capture hash; verification additionally checks that hash and
the code tool fingerprint against the trusted base policy. This does not claim
the design renderer and the code capture CLI are identical binaries.

This workflow runs in Apiary because it is private. Running in Foundation with a
private Apiary checkout is an optional alternative requiring a separately
configured read-only token; no repository secrets are created by this prototype.
