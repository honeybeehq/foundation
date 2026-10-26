# H3 — private team share service on netcup-1

The service is deployed at **https://netcup-1.tailff9529.ts.net:19487/**, with a
pinned Foundation install, native Comb bridge, user systemd supervision, nightly
complete local-store backups and seven-day retention. It is reachable only on
the tailnet. No public/Funnel endpoint was created.

**Real App activated on 2026-10-26.** Both App and installation grant exactly
Metadata read plus Single file read for `.foundation/share.json`. Netcup's fresh
preflight read the private default-branch descriptor (200), refused root Contents
(403), and the reviewed activation script restarted successfully. A real descriptor
probe refused an uncommitted space binding (412). The service and both drill clients
are now pinned to `fc743e72f65eb70e78c6088d681567857b2b2319` for the real two-host
phase, which passed on 2026-10-26. Additional-account denial/removal remains a labelled
stub because no second account is available. Earlier two-host evidence below remains
explicitly historical STUB authorization on build 8848c86.

## Real App drill (2026-10-26)

All three runtimes were pinned to `fc743e72f65eb70e78c6088d681567857b2b2319`.
Studio and metal-3 used real `trmdy` GitHub identity and SSH proofs, and the service
used the accepted App installation, not stub repository permissions.

- Default branch without the descriptor returned404; first init prepared only local
  discovery/recovery, and second init was refused412 with zero server spaces.
  Committing the descriptor enabled init and automatic epoch1 handover to metal-3.
- Three initial changes +6 warmups +40 measured edits produced49 matching changes.
  Both15/19-chunk PNGs arrived, matched full SHA-256, and decoded at1024×768 in
  actual receiver Chromium screenshots/videos; two image edits brought the total51.
- Single Studio-clock request-to-remote-session upper bounds (20/direction):
  Studio→metal p50 334.374ms/p95 412.896ms/max475.598ms; reverse p50 349.989ms/
  p95 703.818ms/max1414.158ms. Shared host load and SSH/control polling are included.
  One measured reverse sample exceeded one second; no all-edits-subsecond claim.
- With the service down/HTTPS502, one local edit per host survived and converged to
  identical53-change HTML/chain bytes after restart, pending0, with both images intact.
  Studio's controller performed the metal offline edit after its helper stalled;
  independent metal readback confirmed it. This coordination delay is not latency.
- Both daemons stopped at pending0. The production backup at
  `data/backups/20261026T095119Z` restored to a fresh scratch directory and then to
  configured production paths. All1979 object hashes and metadata matched, the live
  Comb config hash was unchanged, and original trees were retained for rollback.
  Both daemons restarted without manual lock removal. Two new serial edits produced
  matching55-change bytes and unchanged image hashes. This uses retained clients;
  it is not a fresh-device or old-snapshot rollback drill.
- Removing only the committed default-branch descriptor made an existing token
  return412 and a quiet authenticated relay reach EOF with zero data events.
  Restoring the exact descriptor restored shared/pending0; final55 bytes/images match.
- Current-build local CLI/crypto/Comb refusal/removal/rotation passed with explicitly
  labelled loopback identities and membership. **Real second-account acceptance
  remains untested because no second GitHub account was supplied.**
- All62 share tests (11 files) and standalone root typecheck passed. Nightly backup
  and health timers are active. Both client test process trees/listeners were stopped.

Known operational limitation: stopping the service with open clients reached its
45-second systemd timeout and required SIGKILL. Restart succeeded without lock
cleanup, and backup/restore after client-daemon shutdown stopped promptly. H2d
`3ab85e5` addresses shutdown separately; none of the evidence above is relabelled
as that later build. Its targeted deployment acceptance follows the H3 proof. The backup script now
refuses any non-successful systemd stop, restarts via its EXIT trap, and creates no
snapshot in that failure path. Until H2d is deployed, a connected client can
therefore cause the nightly backup to fail rather than snapshot after SIGKILL.
The deployment-render receipt predates a corrected status message: its old
“App auth remains unconfigured” line was fixed wording, not the actual config state.

Primary evidence includes original receiver screenshots and Chromium videos plus
actual terminal/session recordings. Studio's optional Nectar preview was refused
with E_QUOTA (12 serving environments); primary recordings remain available.
All real and stub client namespaces (including live task tokens/Keychains), scratch
restore and preserved original trees must be
reviewed/deleted by2026-11-01 08:00UTC or receive a dated extension. Production and
its nightly backups remain operational. Backups share the server disk; no off-host
copy or continuous App/durable-write monitoring is claimed. The observed session
registration race required one explicit sync open, without deleting a lock; H2 owns
that follow-up. The native keychain lock is0644 and contains owner metadata only.
Root review:72dcce37 (Opus5.5); Studio review:80f221f3 (Opus5.5); metal summary-only
review:d64e60e3 (Opus5.5). These are separate reviewers with separate scopes.

## Historical pre-gate drill (2026-10-25)

| Check | Evidence and scope |
| --- | --- |
| Deployment and HTTPS | Healthy user service; canonical origin and `honeybeehq` owner restriction configured. A live wrong-owner challenge returns403. |
| Real App initial setup | Studio verified private metadata/admin and Contents403, public Contents-grant422; config transferred directly over SSH, never in messages or Project files. Single-file acceptance and netcup activation passed on 2026-10-26; the real drill passed; see the current results above. |
| Same-account enrollment | Studio and metal-3 used real `trmdy` GitHub identity and SSH keys; automatic epoch1 grant passed without a manual grant. **Server repo permissions were labelled STUB.** |
| Two-host edits | 6 warmups +40 measured actual-session marker/envelope matches, then identical48-change HTML/chain bytes. Measured build8848c86, endpoint19488 with STUB server permissions. |
| Outage | Both actual sessions saved local edits with service502 (20.6ms/31.1ms local control upper bounds). Both converged to identical50-change bytes and shared/pending0. |
| Populated restore | Stopped-store backup; metadata +1551 files restored exactly into a new directory; same endpoint resumed; one edit each way produced identical52-change bytes, shared/pending0. Retained clients, not fresh-device recovery. |
| Raw store |1615 object files: no plaintext/hex marker, node-id or doc-id matches. A real retained ciphertext record rejected an independent random key at AEAD authentication. |
| Refusal/removal/rotation | Actual CLI/crypto/Comb local drill passes, with **labelled loopback identities/membership**. Real additional-account denial/removal still needs accounts. |
| New committed-file gate | Integrated70 tests and root tsc pass. Actual-Comb local drill verifies no space/token before commit, uncommitted412, committed activation, removal412 and quiet relay closure. Its GitHub is a labelled stub reading actual Git HEAD. Real App grant and activation passed on 2026-10-26; see current phase above. |

The temporary19488 proxy and both temporary service units are stopped/removed.
Both client helpers stopped their owned sessions, control listeners and daemons.
Review/delete retained private stub namespaces by **2026-11-01 08:00 UTC**; if
still needed, record a dated extension. Delete complete owned test namespaces,
not only a Mac helper cache. Production and unused real-phase state are separate.
The private test Keychains/vaults/recovery files remain outside repos for proof
verification. No installed Apiary bundle or Design panel code changed.

## Source and placement

Current deployed Foundation source:
`fc743e72f65eb70e78c6088d681567857b2b2319`, upgraded from
`a68d273d35a65e2c08ef5f827fae1ba2255a323a` after the orchestrator requested
the current S7f local-read and A1 encrypted-image rollout for the real drill. It includes the descriptor gate,
space/repo uniqueness fix, Single-file helper and H3 renewable App/vault seams.
The rebase preserved `request(path, false, repo)` for descriptor fetches; static
fixture credentials never replace the production token provider.

Foundation uses the supported `foundation install --from CELL --sha SHA` into
an isolated runtime HOME, `~/.config/foundation-share/data/runtime-home`.
The normal user Foundation launcher/gateway registry was not replaced. One
upgrade used `--force` because the source history was rebased; the installer
retained its runtime-independent rollback command. Runtime installs are immutable
version directories outside the Cell.

Comb was freshly built from
`b73e9bb3ff5e8850a77f36a95df40428fc722891` with
`cargo build -p combctl --bin comb-bridge --release`, and copied to
`~/.config/foundation-share/data/bin/comb-bridge`.

Netcup-1 is suitable: user systemd works, lingering was already enabled, tailnet
HTTPS works, and local disk capacity is sufficient. `~/.local/share` is read-only
inside this Cell, so durable service files use the writable private config tree.
No other checkout or canonical repository was accessed.

Use the local Comb filesystem backend on this single server. Built-in backups
cover stopped metadata and local objects together; S3 would need separate
coordinated provider snapshots. No Comb semantics changed.

## Private files and units

All secrets are outside repos; directory modes are0700, private files0600 and
service umask0077. No private values appear in the recordings.

| Path below `~/.config/foundation-share/` | Purpose |
| --- | --- |
| `service.json` | Loopback bind19487, canonical `publicUrl`, `allowedRepoOwners:["honeybeehq"]`, storage paths. App path is added only after preflight. |
| `github-app.json` | Private RSA App config, transferred directly from Studio with exclusive create. |
| `data/comb/config.toml` | Local backend tenant/digest/root. |
| `data/metadata`, `data/objects` | Production registry and encrypted objects; no live space yet. |
| `data/runtime-home` | Isolated pinned Foundation installation. |
| `data/backups` | Nightly snapshots, separate directory, same host/disk. This protects against logical loss, not host/disk loss. |
| `data/bin` | Installed backup/health/restore/activation shell scripts. |

User units are `foundation-share.service`, `foundation-share-backup.service` and
`.timer`, and `foundation-share-health.service` and `.timer`.

## Restart and health

```sh
systemctl --user restart foundation-share.service
systemctl --user status foundation-share.service
journalctl --user -u foundation-share.service --since '10 minutes ago'
curl --fail https://netcup-1.tailff9529.ts.net:19487/v1/oauth
```

Restart=always restarts unexpected exits after3s; `systemctl stop` stays stopped.
A real whole-cgroup SIGKILL test recovered automatically. The minute health check
repairs a running service that fails HTTP; it leaves intentional stops alone.
Health and backup use the same flock, so health cannot start a stopped writer
during a snapshot. Both held-lock and intentional-stop probes passed.

HTTP health does not prove GitHub or storage write availability. App diagnostics
in the journal contain fixed allowlisted messages; arbitrary provider errors are
redacted. Use the App preflight for permission diagnosis.

Re-render from this checkout with existing absolute executable paths:

```sh
python3 scripts/share-deploy/deploy.py \
  --foundation /ABS/PINNED_VERSION/foundation \
  --comb-bridge /home/trmd/.config/foundation-share/data/bin/comb-bridge \
  --node-bin /opt/node-v24.18.0-linux-x64/bin \
  --public-url https://netcup-1.tailff9529.ts.net:19487 \
  --owner honeybeehq
systemctl --user daemon-reload
```

It preserves existing App/storage config, atomically adds the URL/owner pins,
and refuses conflicting pins or nonexistent executables.

## Enable the real App, then add a repo

After Tormod accepts the Single file grant, run:

```sh
scripts/share-deploy/activate-app.sh /ABS/PINNED_VERSION/foundation \
  /home/trmd/.config/foundation-share/github-app.json \
  honeybeehq/foundation-share-test
```

This helper is **not yet exercised with the new accepted grant**. It first mints
a fresh repo-scoped token, verifies metadata, exact single-file path/read and
Contents refusal, then atomically sets `githubAppConfig` and restarts. HTTP after
restart proves startup; token mint/scope is proved by the preflight. Failure
restores its0600 service-config backup. Each run leaves a private
`service-before-app-*.json`; retain the latest useful rollback copy. A stale
`service.json.new` causes safe refusal: ensure no activation is running, inspect
it privately, remove only that temporary file and retry.

The App must be installed for the repo, with only Metadata:read and
Single file:read scoped to `.foundation/share.json`. No user GitHub token goes to
the service. Tokens mint/cache/refresh in the service. Restart after accepting
new permissions or rotating the App key to clear old cached tokens.

On a member's machine, use two-step initialization:

```sh
foundation share init --service https://netcup-1.tailff9529.ts.net:19487 \
  --repo-root /PRIVATE/REPO --ssh-key /PRIVATE/GITHUB_SSH_KEY
# Commit the prepared secret-free .foundation/share.json to the DEFAULT branch.
foundation share init --repo-root /PRIVATE/REPO --ssh-key /PRIVATE/GITHUB_SSH_KEY
```

The first invocation creates no server space, token or live data. The service
checks the committed default-branch descriptor before registration and every
access; positive checks cache for at most30s. Removing the file stops existing
token access and quiet relays after that bounded cache interval. The descriptor
must name this configured origin, repo, space and encryption mode. Public repos
admit collaborators/organization members with repo access; public repo-read is
refused. Private repo-read remains a compatibility alias.

Peers run `share login` and `sync serve`, using their own local GitHub credentials
and SSH key. Keep recovery codes outside the repo. For the real drill, `h3-real-app` is now the default branch; descriptor commit
`a4fa47b` enabled space `sp_e2e34ea3e539d3b9932cbe647425d5fd` after a recorded
uncommitted-file refusal. The actual scratch repo is private
`honeybeehq/foundation-share-test`. An earlier empty
`trmdy/foundation-share-h3-test` remains untouched.

Rotate the App key by creating a new key in GitHub, updating/validating the
private config on Studio and transferring directly to a new0600 file. Replace
atomically, restart, verify fresh login, then revoke the old key. Never put keys
or tokens in arguments, repo files or messages.

## Nightly backup and scratch restore

Backup runs at03:15 server local time plus up to10min jitter, Persistent=true.
It waits for the shared lock, stops the service, runs `foundation share backup`,
copies matching private Comb config and restarts via EXIT trap if previously
active. Only successful complete snapshots older than7days are pruned. After investigating
a sticky failed service Result on an intentionally stopped service, use
`systemctl --user reset-failed foundation-share.service` before retrying.
Check `systemctl --user is-failed foundation-share-backup.service` and the newest
snapshot age; failures currently have no external alert.

```sh
systemctl --user start foundation-share-backup.service
journalctl --user -u foundation-share-backup.service -n 20
systemctl --user list-timers 'foundation-share-*'
scripts/share-deploy/restore-scratch.sh /ABS/BACKUP /ABS/NEW_SCRATCH
```

Scratch restore refuses an existing target, restores matching registry/objects
and rewrites only the scratch Comb root. Production restore: stop both timers,
wait for any running backup to finish, stop the service, hold `.backup.lock`,
preserve current metadata/objects/config, restore ONE matching snapshot, then
restart service and both timers. Never run another writer against that backend.
Clients with newer epoch pins refuse older registry state. Retain current local
chains; follow [SERVICE.md](../packages/cli/src/share/SERVICE.md) fresh-space reseed
if a matching current snapshot cannot be recovered.

## Mac vault fix and evidence limits

The real two-host drill exposed `security -i`'s4096-byte line limit. Small
updates passed;8KiB/20KiB updates hung, blocking key handover and SIGTERM. The
native Swift Security.framework helper now uses raw stdin/stdout, a10s timeout,
noninteractive failure and a private source/binary-hash-checked cache. Real Mac
65KiB create/192KiB update and full wrapper24KiB/65KiB tests passed. Linux vault
behavior is unchanged. The older SecKeychain APIs are deprecated platform debt.

The native item is separate from the legacy security-created item. First-use
migration copies legacy data read-only and verifies exact bytes. A fsynced0600
marker prevents missing native state from resurrecting stale legacy keys.
**Never delete `~/.foundation/share/helpers` while its Keychain vault is in use.**
Normal Foundation upgrades reuse the same cached helper for unchanged Swift
source. Cache loss, another toolchain or changed helper code can require explicit
recovery; preserve helper, marker and Keychain together. User defaults/search
were unchanged. A shutdown143/stale dead-owner lock remains a lifecycle follow-up;
a subsequent native restart after that exact final lock was not tested.

Measured pre-gate build8848c86, 20 samples/direction, one Studio monotonic clock
from source control request to actual target session marker AND envelope:

| Direction | p50 upper bound | p95 upper bound | Maximum |
| --- | ---: | ---: | ---: |
| Studio → metal-3 |333.5ms|461.5ms|558.4ms|
| metal-3 → Studio |421.2ms|1011.1ms|1238.3ms|

These meet the existing S3c p50≤1000/p95≤1500 targets, but two reverse upper
bounds exceed1s; **no all-edits-subsecond claim**. Under a strict p95<1000ms
interpretation of H3, the reverse upper-bound p95 did not meet that threshold. Studio load was23–25; this is a
shared-host recipe and different backend/collector from S5, with no historical
improvement claim. The current descriptor-gated build has not yet been measured
with real App authorization. Recordings are actual terminal/session output paced
from retained logs; the side-by-side shows independent condensed timelines,
not synchronized screens.

Primary evidence under `.audit/`:

- `H3-proof/two-machine-stub.webm`, `studio-session.webm`, `studio-series.webm`,
  `metal3-session.webm`; raw data under `H3-evidence/Studio` and `H3-evidence/metal3`.
- `H3-twohost-backup-restore.txt`, `H3-raw-store-probe.txt`, outage journal and
  `H3-service-teardown.txt`.
- `H3-gate-tests.txt/.exit`, `H3-gate-local-drill.txt`, `H3-real-app-preflight.txt`.
- Decision trail `.audit/H3-decisions.tsv`; independent Opus reviews covered
  App/ops/native seams, and af916bea covered H2 hint/policy/descriptor changes.

No repository verification skill exists (removed42594d8). Installed
astack-principles, show-me-your-work, perf, diagnosing-bugs, tdd and
technical-writing were used. Actual extra-account membership refusal/removal and
real-App/two-host gate acceptance remain open; labelled stubs do not replace them.
