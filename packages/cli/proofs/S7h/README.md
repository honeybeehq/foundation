# Empty local activity read

Based onaf15694, separate from S7g. Fresh stores previously threw ENOENT on the
first stat of activity-index.json. Both new regressions fail on that baseline.
An absent index now yields an empty, read-only cold baseline and opaque cursor;
no directory or index is created by the reader. A real cursor cannot silently
be reused against a missing index. Corrupt/unsupported indexes, missing segment
files and permission failures still surface as errors.

When a real journal first appears, its retained rows are baseline and the CLI
emits another ready control carrying the real cursor. The initial caught-up
boundary is explicit even for an empty journal; later new facts retain live
classification. This avoids replaying initial history as current presence.

Run `pnpm exec tsx packages/cli/scripts/activity-cold-proof.ts`.
It starts the actual CLI follower with a nonexistent isolated replica store,
checks ready and no filesystem creation, atomically introduces a staged journal
of a real engine change, sees baseline plus the updated ready cursor, writes
another local journal observation, sees live, then sends real SIGTERM and checks
exit0. Journal facts are synthetic local test observations; there is no network,
GitHub, encryption, remote machine or UI claim. real-run.log records each step.

98 share/sync/history tests in22 files pass with --maxWorkers=1; typecheck passes.
The small cache-clear cleanup is rechecked by the focused model tests and the
actual CLI driver. SYNC-LOCAL also records S7g's non-blocking append-only receipt
retention note; that documentation does not change its provenance contract.
