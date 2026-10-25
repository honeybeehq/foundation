# Share service adapter

`startShareService({host?, port?, stateDir, comb:{binary,args}, oauthClientId?})`
returns `{server, url, close}`. Bind defaults to 127.0.0.1 and an ephemeral port.
Terminate HTTPS at the operator's reverse proxy. The service has no CLI command.
The Comb binary/configuration is the existing JSONL bridge described in
`packages/cli/SYNC.md`; credentials stay in that operator-owned configuration.

GitHub requests use api.github.com. `githubApiUrl` is a **development-only** stub
injection restricted to a literal loopback HTTP origin (127.0.0.1 or ::1).
Tests in share-service.test.ts use that stub and a process-level Comb fixture;
they do not constitute a live GitHub or real backend integration drill.

Device registration includes `service`, the exact public service URL used in the
canonical device statement (HTTPS, or HTTP on loopback). This avoids guessing a
public HTTPS URL from an untrusted Host or forwarded header behind a proxy.
The SHA256 statement binds service, space, repo, GitHub login/id and public keys.
SSH statement signature and Ed25519 wrap verification belong to clients. Tokens
bind the sender; the service never claims cryptographic verification of boxes.

Authenticated state/relay accept `?space=SPACE`; keys/rpc accept `space` in the
body. If supplied it must match the token scope. RPC takes op and operation
fields; caller-supplied physical log names are forbidden. Returned frames retain
Comb receipts but expose the logical 64-hex log. Append idempotency_key must
match the encrypted record's dedup. Relay events have no durable cursor.

Same-epoch key handover is allowed for read members. Initial epoch, rotation,
revocation, recovery registration and recovery wraps require write permission.
Recovery public key is optional at initial keys publication, immutable thereafter;
if configured every new epoch must include its recovery wrap. Revocation closes
relay connections and invalidates tokens immediately. Ordinary GitHub removal is
bounded by renewal (one hour); permission lookup outages and ambiguous 404s never
claim confirmed access loss. `accessLost` only reports explicit permission-none
observed during a prior authenticated renewal, and is advisory for clients.

Metadata transactions are serialized and atomically replaced after file fsync.
The existing repository process lock excludes concurrent service owners and
backup. Public devices, recovery public key, wrapped keys and revocations persist;
GitHub credentials, service tokens and plaintext design keys do not.

`backupShareService(config, destination)` requires a stopped service and creates
a new destination containing metadata.json and BACKUP.json. It backs up **only
metadata**. Stop all backend writers and separately snapshot the local/S3 Comb
backend unless the backend supports an atomic snapshot. Preserve the Comb tenant,
digest key and credentials separately. To restore, restore metadata.json into
stateDir together with the matching backend snapshot/configuration before restart.
Copying this metadata directory never backs up S3 contents.
