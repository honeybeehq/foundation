# Automatic sync registration without an editor lock

Based on3ab85e5. H3's sanitized report onfc743e7 showed session stderr containing
`sync registration: Error: document is busy ... Retry the edit`, owner pid50243;
explicit sync open succeeded later without deleting a lock. We reproduced the
same message deterministically: session hello runs inside its own document
transaction and auto-registration attempted to acquire that same lock again.
The two new sync-store regressions both fail on the baseline (before.log).

Automatic registration now reads the durable identity and atomically saves the
local registry record, without acquiring the document lock or changing the
chain. The existing daemon worker upgrades under its own lock before publishing,
checks identity and retries genuine contention. Existing explicit registrations
keep their address. Explicit sync open still upgrades synchronously; its behavior
and chain-format tests remain intact. Before worker startup, status says sharing
pending. This does not change ordinary edit locking or conceal worker errors.

Run:
`pnpm exec tsx packages/cli/scripts/sync-registration-proof.ts /absolute/comb-bridge`

The real-run uses actual CLI/session/daemon processes and Comb b73e9bb local
storage, with an isolated FOUNDATION_REPLICA_STORE. No HOME changes, fake bridge,
GitHub stub, service deployment or UI claim. Session hello registers with no busy
warning. Holding a real document lock makes daemon startup report contention;
releasing it lets the existing worker upgrade to format2 and publish to Comb.
Both processes exit0. An actual CLI edit after closing the registration saves
its token and reopens sharing without a busy warning. See real-run.log.

The first proof observer wrongly expected status blocked while local changes
were pending. Existing status retains sharing pending and exposes the startup
failure in lastError. The observer now checks lastError; its failed run is kept
in observer-before.log. No application fix was made for that observer mistake.

100 tests in22 share/sync/format files pass with --maxWorkers=1; typecheck passes.
