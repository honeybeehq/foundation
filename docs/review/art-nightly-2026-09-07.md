# Art nightly regression review — Foundation — 2026-09-07

## Scope and disposition

This branch-only follow-up starts from
`087389644eb310bad2d72d0c35fb93ca36b503d0`. Root reviewed all 27 supplied
candidates and their call sites. The authoritative candidate ledger is
`/Users/trmd/.hive/crew/art/reviews/2026-09-07/foundation-root-reviewed.json`;
stable patch identities are in the adjacent `foundation-patchids.json`.

| Candidate | Disposition |
| --- | --- |
| `087389644eb310bad2d72d0c35fb93ca36b503d0` | Reviewed clean after subsequent corrections. |
| `f4a996782823345a6b3c54c231a99f34429f8231` | Reviewed clean after subsequent corrections. |
| `3c27d272012a7c3f2abf66eca5cadcd7c18ab154` | Reviewed clean after subsequent corrections. |
| `8ba0c5e74d3b0f71e008833a0f019e8446f0da5c` | Reviewed clean after subsequent corrections. |
| `4a030fb281d2972ea58140a9da80662fe2be3ea8` | Reviewed clean after subsequent corrections. |
| `0f643988d6600a0243aab3bdbffb88f56a5ed0b1` | Reviewed clean after subsequent corrections. |
| `f9321331e7db2dc8287fb2916943b7a5e1feb1d6` | Reviewed clean after subsequent corrections. |
| `1faf339072768db1af2b370150f9fe796d19e1f9` | Reviewed clean after subsequent corrections. |
| `4e0c27b4e2b3ba66ec076b58ede301a31de09918` | Reviewed clean; patch-equivalent to `f9321331`. |
| `80a3fb8c51333a37ac14ff0f0d67bde3ef202f03` | Reviewed clean after subsequent corrections. |
| `0aace37b270a0bd0a070e35030a41ff2611a0cad` | Fixed: desktop export omitted its bundled image assets. |
| `66b321652ab352fca67f495d1a3aee60a9eb0f9b` | Reviewed clean after subsequent corrections. |
| `fcac79eb1e6c95c00c14c161c102c4e86067c831` | Reviewed clean after subsequent corrections. |
| `889601cdf6d41f77d45910630789cf9832e1b38c` | Reviewed clean after subsequent corrections. |
| `faa2749e7ca93aaf37b6d9f074eadf6328727a53` | Reviewed clean after subsequent corrections. |
| `b90958b19ae7ec8d86a7bae16405b80034316487` | Reviewed clean after subsequent corrections. |
| `5e6fd34ca810fc36a9c975534603ca51331d91b9` | Reviewed clean after subsequent corrections. |
| `2d9ce1fb98edbee71c4aaf1a9caa713ecd1a6f7f` | Reviewed clean after subsequent corrections. |
| `84c149810f549d42a436216158849f5ec27d2860` | Reviewed clean after subsequent corrections. |
| `d634c10f05af9bc211b1b4eebaa02c092abc493a` | Reviewed clean after subsequent corrections. |
| `fdde822343bd1ef5b337e10036b22528f55c24ab` | Reviewed clean after subsequent corrections. |
| `c8806f06c826de8c24fd51a1de05ffeab06f6f6a` | Reviewed clean after subsequent corrections. |
| `abc517a9667a496f3ac501a443e70fe6bfc63080` | Reviewed clean; patch-equivalent to `c8806f06`. |
| `80f2e19c8bd223589390f90dcc314d9b9b7d6a65` | Reviewed clean after subsequent corrections. |
| `681fd56e1322f993b72f3b044d6e44dfed7f1f35` | Reviewed clean; patch-equivalent to `80f2e19c`. |
| `b6f84499899913d30c828d7bd3012418375b6bf0` | Reviewed clean after subsequent corrections. |
| `e4da2b9e7e665a401b66eaa07deb59f096e43448` | Reviewed clean after subsequent corrections. |

## Finding: exported HTML omitted bundled images

Severity: medium. Candidate `0aace37b270a0bd0a070e35030a41ff2611a0cad`
connected the desktop to the local host export, but the host writes only the
projected HTML and exact chain snapshot. The desktop seed references bundled
`assets/<hash>.jpeg` files, and neither side copied them. Root's real
`ReplicaStore`/`exportReplica` reproduction in `foundation-export-repro.log`
showed a valid source image and a missing destination image. The worker's
test-first reproduction, `foundation-export-worker-red.log`, failed on the same
missing destination file.

Test commit `8abd1a32f2ad07f274eba200a18f3203ffbd8b3f` preserves that reproduction.
Fix commit `92efcb089309857a07b949a90be5d85f1ca5694c` makes the desktop finish the
host export before reporting success:

- It reads the generated HTML and copies only referenced files in the existing
  `assets/<filename>` vocabulary from the immutable desktop bundle.
- It requires the host's returned HTML and chain paths to be exactly inside the
  chosen export directory.
- It creates the asset directory and each file exclusively, flushes files and
  directories, and refuses collisions without overwriting them.
- A missing or invalid bundled source rejects the export and leaves the fresh,
  incomplete directory reserved, matching the host's crash/no-overwrite rule.
- It does not rewrite the HTML or chain, so the chain history and durable change
  blobs remain byte-for-byte outside this resource-copy step.

Arbitrary imported-document resources remain out of scope. Unsupported nested
or traversal-shaped `assets/` references are rejected rather than copied.

## Verification

| Command or probe | Outcome | Evidence |
| --- | --- | --- |
| Actual baseline `ReplicaStore`/`exportReplica` probe | Failed as expected: HTML source existed, exported asset was absent | `/Users/trmd/.hive/crew/art/reviews/2026-09-07/foundation-export-repro.log` |
| Focused desktop test before implementation | Failed as expected on missing `export/assets/cover.jpeg` | `/Users/trmd/.hive/crew/art/reviews/2026-09-07/foundation-export-worker-red.log` |
| `pnpm vitest run packages/desktop/test/host-client.test.ts` | Passed, 10/10, including copy failure, collision, and path confinement | `/Users/trmd/.hive/crew/art/reviews/2026-09-07/foundation-export-focused-green.log` |
| `pnpm vitest run packages/desktop/test packages/host/test/service.test.ts --maxWorkers=2` | Passed, 21/21 | `/Users/trmd/.hive/crew/art/reviews/2026-09-07/foundation-export-affected-tests.log` |
| `pnpm typecheck` | Passed | `/Users/trmd/.hive/crew/art/reviews/2026-09-07/foundation-export-typecheck.log` |
| `pnpm --dir packages/desktop build` | Passed; two bundled image assets | `/Users/trmd/.hive/crew/art/reviews/2026-09-07/foundation-export-desktop-build.log` |
| `node scripts/build-host.mjs` | Passed | `/Users/trmd/.hive/crew/art/reviews/2026-09-07/foundation-export-host-build.log` |

The repository has no lint script. Root's baseline review also recorded the full
785-test run (777 initial passes and eight load-sensitive timeouts), a 46/46
bounded-worker rerun of the affected timeout files, five prototype tests,
desktop and host builds, browser smoke, real immutable Comb integration, and the
complete packaged two-client acceptance in
`foundation-desktop-live/report.json`. Per the review brief, that unrelated
packaged acceptance was not repeated for this export-only correction; packaged
acceptance remains an integration step for Root.

## Boundaries

The correction is local to the unmerged Foundation feature branch. Nothing was
pushed, installed, or deployed.


## Main publication scope

This main commit publishes the review report only. The reviewed feature code and verified export repair remain on local `art/nightly-2026-09-07-foundation-host`, ending at `7ef08acb715425c2f7f879b4cce639a63546aefb`. No unfinished feature history is merged into main. Root independently reviewed all three repair commits and the passing check logs. The packaged two-client acceptance is baseline evidence, not a fresh export-repair acceptance run.
