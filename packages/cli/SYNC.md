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

Comb retains a writer lease for the lifetime of a publishing bridge. The daemon uses a persistent read-only follower and a separate writer bridge for at most 16 appends, then sends clean EOF to release its lease. This permits nodes to take turns using the supported contract. A crashed writer can delay a new publisher until Comb's lease expires; stable append still protects retries. Backend failures back off from 250ms to 10s; local editing does not involve the bridge.

`status` reports locally saved / waiting to upload / shared (or blocked when an import error prevents receiving), the pending count, saved cursor, last backend/import error and last acknowledged activity. “Shared” means every currently saved envelope was acknowledged by Comb; it does not claim every remote node has imported it.

Run the real-process check with `pnpm exec tsx packages/cli/scripts/sync-proof.ts /absolute/path/comb-bridge`. It creates two independent stores and daemon processes, invokes real CLI edits, observes a real editing-session event, checks duplicate append, denies the local backend during edits, restarts a daemon, restores access, and checks convergence plus an untouched idle copy. Output and a timestamped transcript stay in `.audit/sync-run-*/`. This is a one-machine integration check; cross-machine acceptance belongs to S5.

This initial implementation retains full published-hash history and scans each live chain on the 250ms fallback. Storage and scan cost grow with history and live-copy count; large-history tuning and retention/checkpoint compaction are separate work. Use a separate replica store when deliberately changing backend identity; cursors are scoped to that configured backend.

## Workspace catalogue

The daemon also advertises shared designs on logical `foundation/<workspace>/catalogue` (the same hashed log-name mapping). Add `"node":{"id":"<real Apiary machine id>","name":"metal-1"}` to the Foundation JSON config, or set `FOUNDATION_NODE_ID` and optionally `FOUNDATION_NODE_NAME`. A missing machine id is a visible `catalogueError`; document sync continues. The catalogue contains advisory discovery metadata. Shared backend access and envelope hashes do not authenticate a claimed machine, agent or replica; consumers must not treat records as trusted presence or authorization. `lastAgentEdit` stays null until authenticated provenance is available.

Each local path owns a persistent replica ID and increasing generation. Records include version1, workspace/product/docId, confined repository-relative path, title (up to4096 characters), owner node, head hash, last author/time, and `deleted:false`. The default repository root comes from Git; pass `sync open ... --repo-root /product/checkout` to pin Product-relative paths, especially for submodules, or set `FOUNDATION_REPO_ROOT` when all registered designs share one checkout. Absolute paths are never published. Changing a registration restarts that path's worker.

Only heads whose document envelopes are already shared are advertised. A durable catalogue outbox saves the generation before append, using SHA256(record bytes) as stable key. Restart and lost acknowledgements retry the same generation/key. Catalogue delivery runs separately from document publication, with one writer per workspace and bounded exponential retry. It keeps one in-flight durable generation and the latest queued snapshot per replica, collapsing intervening saves. A hung metadata RPC may delay that workspace's catalogue updates until the35s RPC timeout/lease recovery, but cannot block document uploads.

Closing a registration is not deletion and does not publish a tombstone. Catalogue entries mean “last advertised replica”, not “currently online”; readers must retain staleness/disconnection separately. Moving/deleting a file does not currently retract its old record. A corrupted catalogue checkpoint is surfaced in status; stop the daemon, back up/remove its `replicas/catalogue/<copy-key>.json`, then restart to create a new replica ID. The previous advisory record remains until a later lifecycle/tombstone implementation removes it.
