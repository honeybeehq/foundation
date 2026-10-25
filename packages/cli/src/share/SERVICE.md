# Run the share service

Run one service process in front of an existing Comb bridge. Keep its config and
Comb storage credentials on the server; only the secret-free repo descriptor is
committed. Terminate HTTPS at the tailnet reverse proxy. Deployment is a separate
task; this change starts no permanent service.

```json
{
  "host": "127.0.0.1",
  "port": 19487,
  "stateDir": "/var/lib/foundation-share/metadata",
  "comb": {"binary": "/opt/comb-bridge", "args": ["--dir", "/etc/foundation-comb"]},
  "githubPermissionToken": "METADATA_ONLY_GITHUB_APP_INSTALLATION_TOKEN",
  "oauthClientId": "OPTIONAL_OAUTH_APP_DEVICE_FLOW_CLIENT_ID",
  "backupLocalStore": "/var/lib/foundation-share/objects"
}
```

Protect this file with 0600 permissions. The GitHub App must have repository
Metadata read, no Contents access, and be installed on the selected repos. Supply
and renew its short-lived installation token through operator config and restart
the service when it changes. The optional OAuth App needs device flow enabled;
its client id enables local client sign-in. User GitHub tokens never reach this
service, including when the client uses gh. A client signs a single-use 60-second
nonce with its device key; the service verifies its SSH attestation against GitHub
and checks current permission through its own Metadata-only credential. Tokens
last one hour and are scoped to a space and device. Every issuance repeats checks.

```sh
foundation share serve --config /etc/foundation-share.json
```

Read access fetches and hands over the current epoch; write access creates spaces,
appends, rotates keys and manages recovery. New spaces default to explicit collaborators, including public repositories.
Public repositories admit only collaborators and organization members with repo
access (including team/default organization grants). `repo-read` is refused for
public repositories; it remains a compatibility alias on private repositories. Devices bind their public service origin, repo, space,
GitHub numeric id and login to both public keys. The service validates possession
and direct GitHub identity/key ownership. A successful explicit client
re-attestation updates the SSH signature without changing immutable device keys;
a revoked id requires a fresh device. Peers separately verify all key handovers.
Storage contains public registry metadata and opaque sealed boxes/ciphertexts.
Revocation closes relay connections immediately. Confirmed renewal loss blocks
old-epoch appends until a writer rotates. Ambiguous GitHub failures are not loss.

HTTP lives under `/v1`: challenge, spaces, token, state, keys, rpc, relay and oauth.
State/relay accept a space query; key/RPC bodies accept space. Bearers use headers.
RPC wraps hello/head/read/append plus an authenticated `hint` operation; physical Comb names are built on the server.
Encrypted records must include epoch, key id, keyed dedup, nonce, ciphertext and
sender signature. The service checks sender/token binding and epoch; clients check
cryptography. The hint operation applies the same writer, current-epoch and ciphertext
checks as append, then relays without writing Comb or returning a cursor. An
independent bounded client queue keeps later hints moving while a durable append
waits. SSE carries immediate encrypted hints without durable cursors. Slow
subscribers disconnect and recover by durable replay. Bounds cover bodies, state,
requests, challenges, connections, pages and SSH verification concurrency.

The `githubApiUrl` option is a development-only injection restricted to literal
loopback HTTP. Never configure it in production. Unit tests use a labelled GitHub
stub and process-level Comb fixture. The real drill uses the actual Comb binary.

## Nightly backup and restore

Use the local Comb backend for the complete built-in backup path. Stop the service
and any other writer to that same backend before copying. `backupLocalStore` must
name the actual backend root, not metadata or a parent directory containing the
backup destination. Use a new destination outside the source directories.

```sh
systemctl stop foundation-share
foundation share backup /backups/foundation-share/2026-10-25 --config /etc/foundation-share.json
systemctl start foundation-share
```

The process lock spans metadata and local backend copying. The destination holds
`metadata.json`, `comb-store/` and `BACKUP.json` with `backendIncluded:true`.
The command refuses a missing local-store path instead of presenting metadata as a
complete backup. Preserve matching tenant/digest/storage configuration separately
in your secret backup. For S3, use provider versioning/snapshots and a separately
coordinated stopped-store snapshot; this command does not back up S3 objects.

To restore, stop writers, restore metadata into stateDir and comb-store into its
configured root, then restore matching Comb config from the secret backup before
starting. Do not mix registry and backend snapshots from different times. Clients
with newer local epoch pins will refuse an old restored epoch. There is no automatic rollback bypass. If a matching current registry snapshot is
unavailable, keep git/current local chains, select a fresh empty service stateDir
and backend namespace, save/remove the old descriptor, and run share init again.
Commit the new descriptor, sign devices in and reopen designs to reseed a fresh
space from retained chains. Do not delete the old store until recovery is verified.
