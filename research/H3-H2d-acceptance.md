# H3 operational follow-up: graceful shutdown and connected-client backup

This is separate from core H3 proof `proof-e84e26bacb6b2e04c30c5193c6fbcdb1`.
The full real two-host/image/outage/restore drill remains pinned to fc743e7.

## Targeted acceptance

Server `f82766445dced6768a060ad6eb8128f5abad206b` combines reviewed H2d
`3ab85e5` with the H3 backup stop-result guard. The retained Studio client stayed
on fc743e7; no document writes were issued in this follow-up.

- An actual client daemon/session and an authenticated quiet relay were open.
  `systemctl --user stop foundation-share.service` returned0 in **0.034114s**,
  with `Result=success`, `ActiveState=inactive`, `SubState=dead`. No SIGKILL.
- Start returned0; tailnet HTTPS returned200, with the unit active/success.
  The daemon renewed its token automatically and returned to healthy shared state.
  The observer reopened authenticated state200/relay200. The daemon's own SSE
  reconnect was not instrumented, and no new data roundtrip was tested here.
- With another authenticated relay and the client still connected, the actual
  guarded backup unit completed in **1.178654s**, `Result=success`, and restarted
  the service successfully. Snapshot `data/backups/20261026T104038Z` is
  `complete-local-store` with `backendIncluded=true`. The observer reconnected
  again; shared/pending0, all55 changes and both image hashes remained unchanged.
- Each shutdown observer saw one data line before remote EOF. H2d emits an
  `event: close` shutdown notification; the second observer retained that event
  name. Payload text was not retained, so no exact wire-payload claim is made.
- Both timers were restored active. Backup unit is not failed; the next nightly
  run is scheduled. No external failed-backup alert has been added.

Root receipts are `.audit/H3-H2d-systemctl-stop.json`, `H3-H2d-restart.json`,
`H3-H2d-connected-backup.json`, `H3-H2d-final-ops.json`, and the service journal.
Client receipts are in `.audit/H3-H2d-evidence/Studio-H2d-20261026/`.
The separately scanned client archive SHA is
`26a87424eda9c455ab8613125ea5a30192afcf833acc89a77e3a5a23dd99ddb8`.
Core dated archives were rehashed unchanged.

## Current service pin and handoff

After the targeted acceptance, the orchestrator requested rollout
`8036e2955961fb93a78f4328487720bd42e17a9e`. H2 lead698d4680 confirmed the
server code is identical; the local byte comparison of share/**, share command,
main, bridge and engine was empty. Only client sync-store and sync-status runtime
files differ. The service now runs that exact SHA, dirty=false; restart/HTTPS
passed. The installed backup guard remains byte-identical to the H3 guard
(SHA256 `ac6710c0f9035387ac3ff9de96307f3438f885176a67fcef6736e326609edcc7`).

The supported installer needed `--force` only for the nonancestor sibling source
histories (f827664 contains H3 commits absent from8036); it touched only the
private service runtime and retained a rollback. This was not a serving-code
or permission downgrade. Immutable source/version receipts are under
`.audit/H3-H2e-*`.

S9 may use fresh private client states and a new design on a nondefault branch
of `honeybeehq/foundation-share-test`. Its Studio device received epoch1 through
automatic handover from the retained H3 maintainer; no vault/key material was
copied or messaged. H3's maintainer then stopped. Preserve the default branch,
committed descriptor, space `sp_e2e34ea3e539d3b9932cbe647425d5fd`, H3 board/chain
and existing immutable assets. S9 may add its own design/assets. Full service
outages require a coordinated checkpoint with the deployment owner.

The original real-second-account gap, same-disk backup limit, liveness-only
health, native helper cdhash dependency and November1 test-secret review/delete
deadline remain. The core shutdown-timeout limitation is superseded only by
this separately labelled operational acceptance, not by relabelling old evidence.
