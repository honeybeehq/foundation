# Node sync through Comb

Save and edit locally as usual. Build `comb-bridge` from Comb source (`cargo build -p combctl --bin comb-bridge`), then create a private Comb configuration directory. Preserve its tenant and digest key between restarts:

```toml
# /private/comb/config.toml
tenant = "foundation"
digest_key = "<64 random hexadecimal characters>"
[backend]
kind = "local"
root = "/private/comb/objects"
```

For S3-compatible storage, replace the backend section with `kind = "s3"`, `bucket`, `region`, `prefix`, and optional `endpoint`/`profile`. Credentials use Comb's supported environment/profile configuration. Each node must use the same tenant, digest key and shared backend. No hosted Comb server is required. Do not trim these feeds: full history is required for replay.

Foundation's configuration file only describes the supported process boundary:

```json
{"binary":"/absolute/path/comb-bridge","args":["--dir","/private/comb"]}
```

Run these with the installed `foundation` command (or `pnpm exec tsx packages/cli/src/main.ts` in this checkout):

```sh
foundation sync open board.fdn.html --workspace my-workspace --product my-product
foundation sync serve --comb-config /private/foundation-comb.json
foundation sync status --json
foundation sync close board.fdn.html
```

The daemon owns one lock in `~/.foundation/replicas/`. `FOUNDATION_REPLICA_STORE` overrides that root for tests. Registration is explicit and persists until `sync close`; an idle unregistered copy is never written. Each registered path has its own replay cursor, including multiple copies of the same design. `close` stops watching/importing that copy; reopening resumes its saved cursor. A new path replays from the beginning.

For automatic registration by editing sessions (including semantic CLI/MCP edits), set `FOUNDATION_SYNC_AUTO_OPEN=1` in the Foundation process environment, together with `FOUNDATION_WORKSPACE` and `FOUNDATION_PRODUCT`. Successful mutating document CLI commands also register; inspect does not. An existing explicit address is preserved. Registration failure logs a diagnostic and never fails the local edit. Integrations that do not create an editing session should call `foundation sync open <file>` when opening a design and `foundation sync close <file>` when it ceases to be live. Automatic registration also persists until explicit close; this initial hook does not reference-count multiple clients. With auto-open enabled, the next session open or edit registers a closed design again; there is no lasting per-file opt-out. Disable auto-open and use explicit hooks when that is needed. `sync open` is the reliable hook for other MCP tools such as annotation-only operations.

A logical address is `foundation/<workspace>/<product>/<docId>`. Comb log names cannot contain slashes, so the wire name is `foundation-<SHA256 of logical address>`. The stable append key is the envelope hash; the payload is the same length-prefixed `.fdnc` frame as directory exchange. Workspace/product/docId address parts accept ASCII letters, digits, dots, underscores and hyphens.

The chain is the outbox. The daemon records a published hash only after Comb acknowledges it, and advances a receive cursor only after importing a validated page through the locked local save boundary. If a checkpoint write fails or an acknowledgement is lost, replay and stable-key append make retries harmless. Bad framing, hashes, identity changes, incomplete history and cursor gaps stop that copy's import with a visible status error. They never become visible as partial changes. Errors include the failing cursor (or oversized change hash) and failure time. A bad event deliberately blocks that design at its cursor; it does not stop other designs. Foundation does not skip or rewrite delivery history. Stop the affected replica and repair/replay its feed through the backend owner before resuming. For an oversized change, preserve the original chain, then split/re-author the operation below the bridge limit using a new design/feed; the daemon cannot publish that history through this bounded bridge. For a damaged local checkpoint, stop the daemon, back up/remove that copy’s state JSON, and restart to replay from cursor1 (stable append protects re-publication). Raw HTML edits require `foundation ingest <file> --commit` to create envelopes before publication. Only frontier growth (or a pending local source edit) writes the document. Comb delivery order is not the document clock; Loro merges history.

Comb retains a writer lease for the lifetime of a publishing bridge. The daemon uses a persistent read-only follower and a separate writer bridge for at most 16 appends, then sends clean EOF to release its lease. This permits nodes to take turns using the supported contract. A crashed writer can delay a new publisher until Comb's lease expires; stable append still protects retries. Backend retries use independent 250ms bases capped at 5s, with 0.5–1× jitter; local editing does not involve the bridge.

`status` reports locally saved / waiting to upload / shared (or blocked when an import error prevents receiving), the pending count, saved cursor, last backend/import error and last acknowledged activity. “Shared” means every currently saved envelope was acknowledged by Comb; it does not claim every remote node has imported it.

Run the real-process check with `pnpm exec tsx packages/cli/scripts/sync-proof.ts /absolute/path/comb-bridge`. It creates two independent stores and daemon processes, invokes real CLI edits, observes a real editing-session event, checks duplicate append, denies the local backend during edits, restarts a daemon, restores access, and checks convergence plus an untouched idle copy. Output and a timestamped transcript stay in `.audit/sync-run-*/`. This is a one-machine integration check; cross-machine acceptance belongs to S5.

This initial implementation retains full published-hash history and scans each live chain on the 250ms fallback. Storage and scan cost grow with history and live-copy count; large-history tuning and retention/checkpoint compaction are separate work. Use a separate replica store when deliberately changing backend identity; cursors are scoped to that configured backend.

## Workspace catalogue

The daemon also advertises shared designs on logical `foundation/<workspace>/catalogue` (the same hashed log-name mapping). Add `"node":{"id":"<real Apiary machine id>","name":"metal-1"}` to the Foundation JSON config, or set `FOUNDATION_NODE_ID` and optionally `FOUNDATION_NODE_NAME`. A missing machine id is a visible `catalogueError`; document sync continues. The catalogue contains advisory discovery metadata. Shared backend access and envelope hashes do not authenticate a claimed machine, agent or replica; consumers must not treat records as trusted presence or authorization. `lastAgentEdit` stays null until authenticated provenance is available.

Each local path owns a persistent replica ID and increasing generation. Records include version1, workspace/product/docId, confined repository-relative path, title (up to4096 characters), owner node, head hash, last author/time, and `deleted:false`. The default repository root comes from Git; pass `sync open ... --repo-root /product/checkout` to pin Product-relative paths, especially for submodules, or set `FOUNDATION_REPO_ROOT` when all registered designs share one checkout. Absolute paths are never published. Changing a registration restarts that path's worker.

Only heads whose document envelopes are already shared are advertised. A durable catalogue outbox saves the generation before append, using SHA256(record bytes) as stable key. Restart and lost acknowledgements retry the same generation/key. Catalogue delivery runs separately from document publication, with one writer per workspace and bounded exponential retry. It keeps one in-flight durable generation and the latest queued snapshot per replica, collapsing intervening saves. A hung metadata RPC may delay that workspace's catalogue updates until the35s RPC timeout/lease recovery, but cannot block document uploads.

Closing a registration is not deletion and does not publish a tombstone. Catalogue entries mean “last advertised replica”, not “currently online”; readers must retain staleness/disconnection separately. Moving/deleting a file does not currently retract its old record. A corrupted catalogue checkpoint is surfaced in status; stop the daemon, back up/remove its `replicas/catalogue/<copy-key>.json`, then restart to create a new replica ID. The previous advisory record remains until a later lifecycle/tombstone implementation removes it.

## Recover a design into a fresh checkout

Create or select an existing Product checkout root, then replay a design directly from the retained Comb feed:

```sh
foundation sync materialize DOC_ID boards/design.fdn.html \
  --workspace WORKSPACE --product PRODUCT --repo-root /local/product \
  --comb-config /private/foundation-comb.json --json
```

Omit the target to use a deterministic live catalogue replica's confined `repoRelativePath`. `--source-replica ID` chooses a specific advertised replica. Alternatively pass `--entry catalogue-entry.json`, which accepts the catalogue's workspaceId/productId/docId/replicaId/repoRelativePath/headHash fields. `materialise` is an alias.

`--expected-head HASH` requires that change to be present in the replayed history; a later head is merged rather than refused. `--request-key KEY` is echoed in the settled result for callers. Repeating the request is safe: a matching local design merges into its latest locked state and preserves local edits. The command returns `state:"ready"`, DesignRef, local `path`/`repoPath`, `headHash`, and `requestKey`; with `--json`, known refusals return `state:"refused"`, `code`, and `message` with exit1. Codes include path-conflict, product-unavailable, history-unavailable, deleted-source, invalid-history, invalid-path, local-io and registration-failed. A registration failure after saving includes the saved path so callers can retry registration without treating the design as absent.

The command captures the feed head, reads bounded pages from cursor1, validates framing and envelope hashes, restores the original update bytes, checks docId/causal completeness and full `candidate.verify()`, then saves through the G16 lock and normal pending-save receipt. It seeds the replayed cursor and shared hashes before live registration, so startup does not re-append recovered history. Merged local-only edits remain pending upload. Incoming edits beyond the captured head arrive through the daemon after registration. No source file is needed, no replacement genesis is authored, and no Git repository is implicitly cloned.

Targets must remain within the checkout root. Document/save sibling symlinks (including dangling links) and Git metadata paths are refused. A registration under another workspace/product, foreign docId, unrelated genesis or untracked existing file is refused without overwrite. Missing/truncated/corrupt history produces no target document. Conflicting advertised paths require an explicit target or source replica. Catalogue lookup scans retained workspace metadata; complete document history is held in memory while reconstructing the chain. Catalogue records are advisory; paths are confined again locally, and document identity comes from verified history. The CLI settles after network replay; an apiaryd/Waggle caller should return its own accepted/materialising state immediately and invoke this command in the background.

Only envelope history is transported. Local named anchors are not published by the design feed, so they cannot be recreated on a fresh replica; byte equality with a source's `.chain` requires equivalent anchors and encoder version. The real drill uses designs without local-only anchors.

Reproduce fresh-directory recovery and subsequent bidirectional editing with `pnpm exec tsx packages/cli/scripts/materialize-proof.ts /path/to/comb-bridge`.

### Optional direct acceleration

The JSON process config may add `direct` alongside `binary`, `args`, and `node`:

```json
{
  "direct": {
    "listen": { "host": "100.64.0.1", "port": 19486 },
    "workspaces": {
      "my-workspace": {
        "secret": "replace-with-a-random-secret-of-at-least-32-characters",
        "peers": [{ "nodeId": "other-node-id", "url": "http://100.64.0.2:19486" }]
      }
    }
  }
}
```

Bind to your explicit tailnet address and keep this config private (mode 0600).
Configure the same workspace secret and reciprocal allowed node ids on peers.
The shared secret authenticates workspace membership; the claimed node id is an
allowlist key, not author provenance. HMAC covers POST, `/changes`, and the exact
body, including address, sender and timestamp. Replays within the 60-second clock
window are harmless because imports deduplicate by verified envelope hash.

After noticing a local save, the daemon sends bounded envelope batches directly
while Comb publication proceeds. Only live registered paths can receive them.
Every new change still passes strict candidate verification and the normal save
lock. Direct delivery changes neither the Comb cursor nor the published set;
status stays waiting to upload until durable delivery/acknowledgement. A receiver
does not forward hashes received directly during that daemon run. It waits 5–10 seconds before a fallback
append if the sender disappeared. This grace is in memory; restarting deliberately
uses up the grace and permits immediate idempotent fallback publication. Because
receipt provenance is in memory, restart may also reannounce unacknowledged
history once. An author receiving that echo may acquire one 5–10s grace hold;
later local descendants wait behind it. Replays do not extend an existing hold.

Requests are limited to 1 MiB, 16 frames, 32 concurrent connections and two-second
network timeouts. Missing parents, clock skew, disconnected peers and lost requests
fall back to Comb; direct errors do not clear blocked feed status. Listener startup
failure disables acceleration without stopping durable sync. `sync status --json`
includes `direct.state` and `direct.reason`; per-request outcomes are available in
opt-in stage traces. All hints may be disabled by omitting `direct`.

Duplicate Comb delivery still validates every frame and hash, but skips candidate
replay when no new hash exists. Existing v1 stores undergo the normal one-time v2
storage upgrade; subsequent duplicate pages do not rewrite either document file.

Direct dispatch uses its own file-event wakeup and stat-gated 250 ms fallback,
so an earlier Comb append cannot hold up a later direct send. Durable publication
uses a prefix of Lamport-ordered changes and stops before the first direct-received
hash still in its grace period. This deliberately holds later local changes too:
a descendant must never enter the feed before its full native causal history.
Once the parent arrives through Comb (or grace expires), publication resumes.

Performance receipts and the CLI-local workload map are in `packages/cli/performance/`
and `packages/cli/.claude/skills/perf-foundation-sync/`. The latency target measures
save-to-other-session visibility; durable Comb acknowledgement is reported separately.

Worker startup failures are retried with jittered backoff capped at5s and appear
as connection errors in status. The saved cursor and published set are preserved.
A corrupt checkpoint remains unchanged until explicitly repaired; status reports
its parse/read error. Startup retry sleep can delay shutdown by up to5s.

## Encrypted sharing per repository

Keep `.foundation/share.json` in the repository to select live sharing. Without it,
or with `{"version":1,"mode":"git-only"}`, the default daemon makes no network
connection for that repository. An explicit `--comb-config` still selects the older
trusted development transport described above.

Prerequisites: OpenSSH with `ssh-keygen -Y`, a GitHub SSH key available locally or
through ssh-agent (`--ssh-key ~/.ssh/key.pub` works with an agent), and GitHub login.
The client uses its own `gh auth token` or OAuth device-flow token for **direct**
GitHub identity/member checks. It never sends that token to the share service.
The service needs a GitHub App installation credential with repository **Metadata:
read** and no Contents permission. Do not give the service a repo-scoped PAT.

```sh
foundation share init --service https://share.example.ts.net --ssh-key ~/.ssh/id_ed25519
# Commit .foundation/share.json, including its public recovery-key pin.
foundation share login --ssh-key ~/.ssh/id_ed25519
foundation sync serve
foundation share status --json
```

`--oauth` performs GitHub device sign-in locally using the service's configured
OAuth App client id. `--token-stdin` accepts a local GitHub token without putting
it in process arguments. `--repo-root` selects a checkout explicitly. `share init`
can take `--repo github.com/OWNER/REPO` instead of inferring origin. Public repos
follow repo read access by default; `--public-access collaborators` instead limits
live keys to explicitly listed collaborators. Every peer enforces that committed
policy independently. Read members receive keys and fetch; only writers append.

The descriptor adds public `recoveryPublicKey` and `publicAccess` fields to the
version 1 discovery shape. Keys are mandatory end-to-end (`e2e-v1`); encryption
cannot be downgraded. Document feeds depend on space and document id, not local
workspace/product ids. Opening/editing a design in a shared repo registers it
automatically; explicit `sync close` stops its imports until the next open/edit.
Signed-in repo roots are remembered locally, so daemon key handover also works
when no design is open. A daemon must be running on at least one key-holding
member. `share grant` runs the same independent checks immediately.

`share status` distinguishes git-only, sign in, no access, waiting for key, shared,
and unavailable with a reason. `sync status --json` adds `sharing` for consumers
such as the Design panel. No Design panel code is changed here. Missing keys or
service/GitHub failures leave ordinary git and local editing available.

The OS Keychain holds device secrets and local GitHub tokens on macOS. Headless
Linux uses a 0600 file in a 0700 `~/.foundation/share` directory; symlink/insecure
secret files are refused. Recovery codes are written once to a private file in
that directory, never printed. Move that file offline. To restore on a newly
signed-in device, use `share recovery restore --code-file /private/code.txt`.
`share recovery rotate` creates a new recovery key and design epoch: commit the
updated descriptor and have teammates pull it. An old descriptor produces a
visible pin-mismatch alarm until updated. Keep the recovery holder trusted until
rotation. `share revoke-device DEVICE_ID` rotates and revokes immediately; for a
stolen machine also remove its SSH key from GitHub and revoke its GitHub tokens.

Clients verify GitHub SSH bindings and current permissions independently before
handing over a sealed key or accepting a writer-certified epoch. Signed recipient
lists remain in local epoch packages; hiding a device from service state does not
erase known recipients. Full checks run before sending after startup and every
120 seconds. GitHub failures never imply removal; a successful check has a one-hour
grace, after which appends pause with the last-check time. Writers self-rotate
at 24 hours before another append. Local monotonic epochs reject service rollback;
key identifiers produce explicit fork errors. A malicious service can still deny
or freeze data; there is no transparency log or global latest-epoch guarantee.
Devices that receive historical keys are additional readers of those epochs;
under hidden grants, a frozen writer rotates within 24 hours or holds appends.

Changes, catalogue records and chain annotations cross the encryption boundary
before network/storage; the generic feed transport also encrypts future presence
fact payloads. This change does not add a separate presence publisher. Symmetric
content uses libsodium XChaCha20-Poly1305; keys use sealed boxes and signed writer
certificates. New records carry device signatures; current-epoch signers must
currently have write access. Historical record signatures remain checkable after
removal, while historical authorization relies on the service's original append
permission check. Feed pseudonyms stay stable across epochs (removed members can
link known feeds), while dedup keys rotate and are feed-specific. Plaintext S1b
identities and chain/blob formats are unchanged.

Encrypted sharing currently accepts at most 350000 plaintext bytes per append.
The service serializes appends per feed, scans bounded durable pages to coalesce
randomly encrypted retries, then appends through Comb without changing Comb's
semantics. Full retained-feed scans and registry polling are initial scaling costs.
Relay receipt gives immediate visibility; only a durable Comb receipt marks shared.

Run `pnpm exec tsx packages/cli/scripts/share-proof.ts /absolute/comb-bridge` for
a real two-HOME CLI/daemon/Comb drill. Its multiple GitHub identities, permissions
and SSH-key directory are an explicitly labelled loopback stub; encryption,
SSH signing, processes, relay, storage and refusal paths are real. Logs remain in
`.audit/share-run-*`. A real GitHub App setup and second account are needed for a
fully live multi-account acceptance run. Service/config/backup instructions follow
in [the service guide](src/share/SERVICE.md).
