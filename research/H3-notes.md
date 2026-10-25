# H3: netcup team share deployment

Deployment in progress; real GitHub App creation and extra accounts are pending.
No claim of real multi-account acceptance yet.

## Placement and installed components

The service runs as `trmd` on netcup-1. User systemd is available and lingering is
already enabled. HTTPS is **tailnet only**:
`https://netcup-1.tailff9529.ts.net:19487/` via Tailscale Serve to loopback
`127.0.0.1:19487`. No Funnel or public listener was configured.

Foundation was installed with the supported `foundation install --from CELL --sha
65946e350b339bda8a23d022c73e6782643a9aad` into an isolated runtime HOME at
`/home/trmd/.config/foundation-share/data/runtime-home`. The node's ordinary
Foundation launcher and gateway registry were not replaced. This is an interim
revision pending H2's independent relay-hint fix before the two-host measurement.
Comb was freshly cloned inside this Cell, checked out at
`b73e9bb3ff5e8850a77f36a95df40428fc722891` and built with
`cargo build -p combctl --bin comb-bridge --release`. Its installed executable is
`~/.config/foundation-share/data/bin/comb-bridge`.

Use the local Comb filesystem backend for this single server. H2's built-in
backup covers a stopped local backend and matching metadata together; S3 would
need a separate coordinated snapshot mechanism. No Comb semantic changes.
`~/.local/share` is read-only from this Cell; the writable private config tree is
outside the repository and persists independently of the Cell.

Private paths, all outside repositories:

- `~/.config/foundation-share/service.json`: loopback service configuration, 0600.
- `~/.config/foundation-share/github-app.json`: expected real App config, 0600;
  not provisioned yet. Studio H2c agent transfers directly via tailnet SSH/scp,
  refusing overwrite. No private values in messages or Project files.
- `~/.config/foundation-share/data/comb/config.toml`: tenant/digest/backend, 0600.
- `~/.config/foundation-share/data/metadata` and `objects`: service registry and
  encrypted local backend. Parent directories 0700, unit umask 0077.
- `~/.config/foundation-share/data/backups`: separate snapshot directory, 0700,
  seven-day retention. It is on the same host/disk; this does not protect against
  server/disk loss. Matching private Comb config is copied into each snapshot.

The production service currently has no GitHub credential and fails closed on
private-repo authorization. The separate one-machine multi-account drill is
explicitly labelled a loopback GitHub stub, never production authentication.

## App auth seam

Commit `65946e3` adds `githubAppConfig`, an absolute private config path, to service
auth. All API metadata/identity/permission requests receive a repository-scoped
Metadata-only installation token through H2c's `metadataToken`. SSH keys remain
credential-free. H2c mints and caches tokens, refreshing before expiration.
App/static-token/stub mixtures are refused; static token remains for fixtures.
Errors from the provider are redacted. H2 lead reviewed the patch with no findings
(source review; did not independently rerun our tests).

Verification: 34 share tests in six files pass, and `tsc --noEmit` passes. The
actual Comb/CLI two-HOME drill passes key handover, subsecond edits both ways,
outsider refusal, removal/rotation, raw-store plaintext and docId grep, tamper and
rollback refusals, outage/recovery and stopped-store backup. GitHub identities in
that drill are **stubs**, and it runs on one host.

## Operations

Re-render units with `scripts/share-deploy/deploy.py`, supplying the absolute
pinned Foundation launcher, installed Comb bridge, and Node bin directory. It
preserves existing operator configuration. For a brand-new empty registry, stop
the service before rendering. Units use the actual Node directory in PATH.

Restart and inspect:

```sh
systemctl --user restart foundation-share.service
systemctl --user status foundation-share.service
journalctl --user -u foundation-share.service --since '10 minutes ago'
curl --fail https://netcup-1.tailff9529.ts.net:19487/v1/oauth
```

The service restarts on failure after three seconds. The minute health check
probes HTTP `/v1/oauth` while the service is running and restarts on HTTP failure.
An intentionally stopped service stays stopped. This is process/HTTP liveness, not
a GitHub or durable backend write probe. Health and backup share a filesystem lock; health skips the entire stopped backup window, including oneshot activating state. A real stopped-service lock probe verifies health does not restart it.

Nightly backup runs at 03:15 server local time plus up to ten minutes jitter,
with Persistent=true. Run/test it manually:

```sh
systemctl --user start foundation-share-backup.service
journalctl --user -u foundation-share-backup.service -n 20
systemctl --user list-timers 'foundation-share-*'
```

`backup.sh` serializes snapshots, stops the service, runs `foundation share
backup`, copies matching private Comb config, and restarts via EXIT trap if it
was previously active. Only successful complete snapshots older than seven days
are pruned. Never start a second writer against the production backend.

Restore into a new scratch directory first:

```sh
scripts/share-deploy/restore-scratch.sh /ABS/BACKUP /ABS/NEW_SCRATCH
```

It refuses an existing target, copies registry and objects, rewrites only the
scratch Comb root and keeps private config mode 0600. Test the scratch backend
and service before a production restore. To restore production, stop `foundation-share-health.timer` and the service,
preserve the current registry/objects/config in another private directory, copy
one matching snapshot into the configured paths, restore matching tenant/digest
config, then start the service and health timer. Never mix snapshot times. Clients with newer epoch pins
refuse an old restored registry; retain local chains and follow H2's fresh-space
reseed procedure if a matching current registry cannot be recovered.

Rotate the App key: create/download a new private key through GitHub's App
settings; rebuild/validate the private config on Studio; transfer directly to a
new 0600 file, then atomically replace the service config file and restart. H2c's
cache keys include app id/repo/path, so restart is required on private-key
rotation. Verify a fresh real login before revoking the previous key. Never put
private keys or installation tokens in command arguments, logs or repo files.

Add a repo: install the Metadata-only App on the chosen repo; on a member's
machine run `foundation share init --service URL --ssh-key KEY --repo-root REPO`
and commit its secret-free `.foundation/share.json`. Peers use their own GitHub
sign-in and SSH keys. Keep the recovery code outside the repo. Public-repo policy
is Tormod's decision; this task uses a private scratch repo only.

## Drill status and evidence

Studio created PRIVATE `honeybeehq/foundation-share-test`, confirmed ADMIN. An
initial private user repo `trmdy/foundation-share-h3-test` was also created before
the App ownership constraint was discovered; it remains empty and untouched.
The org repo is the actual H3 target because the private org App cannot install
on a different owning account.

Studio and metal-3 both verified trmdy's real GitHub identity and local SSH
signature against GitHub `.keys`; no credential was printed or exported to the
service. Both helpers own fresh Cells and will use isolated runtime/vault HOMEs.
Real App init, automatic same-account key handover, cross-host edit timing,
service outage and populated snapshot restore still await App and final H2 build.
Second-account denial and membership removal/rotation need additional real
GitHub accounts. Stub checks do not substitute for those live claims.

Local evidence under `.audit/`: H3-share-tests.txt, H3-typecheck.txt,
H3-install.txt, H3-labelled-stub-drill.txt, H3-restore.txt, H3-service-restart.txt,
H3-decisions.tsv. The first scheduled backup failed before the new empty registry
had been initialized; after initialization the real backup unit passed and
restored to a separate scratch directory with a successful Comb handshake.
This first deployment restore contains an empty registry; populated proof is
pending. Deployment scripts now initialize an empty registry before first start.
