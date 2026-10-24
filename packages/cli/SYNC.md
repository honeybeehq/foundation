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

For automatic registration by editing sessions (including semantic CLI/MCP edits), set `FOUNDATION_SYNC_AUTO_OPEN=1` in the Foundation process environment, together with `FOUNDATION_WORKSPACE` and `FOUNDATION_PRODUCT`. Successful document CLI commands also register. Registration failure logs a diagnostic and never fails the local edit. Integrations that do not create an editing session should call `foundation sync open <file>` when opening a design and `foundation sync close <file>` when it ceases to be live. Automatic registration also persists until explicit close; this initial hook does not reference-count multiple clients. `sync open` is the reliable hook for other MCP tools such as annotation-only operations.

A logical address is `foundation/<workspace>/<product>/<docId>`. Comb log names cannot contain slashes, so the wire name is `foundation-<SHA256 of logical address>`. The stable append key is the envelope hash; the payload is the same length-prefixed `.fdnc` frame as directory exchange. Workspace/product/docId address parts accept ASCII letters, digits, dots, underscores and hyphens.

The chain is the outbox. The daemon records a published hash only after Comb acknowledges it, and advances a receive cursor only after importing a validated page through the locked local save boundary. If a checkpoint write fails or an acknowledgement is lost, replay and stable-key append make retries harmless. Bad framing, hashes, identity changes, incomplete history and cursor gaps stop that copy's import with a visible status error. They never become visible as partial changes. Only frontier growth (or a pending local source edit) writes the document. Comb delivery order is not the document clock; Loro merges history.

Comb retains a writer lease for the lifetime of a publishing bridge. The daemon uses a persistent read-only follower and a separate writer bridge for at most 16 appends, then sends clean EOF to release its lease. This permits nodes to take turns using the supported contract. A crashed writer can delay a new publisher until Comb's lease expires; stable append still protects retries. Backend failures back off from 250ms to 10s; local editing does not involve the bridge.

`status` reports locally saved / waiting to upload / shared, the pending count, saved cursor, last backend/import error and last acknowledged activity. “Shared” means every currently saved envelope was acknowledged by Comb; it does not claim every remote node has imported it.

Run the real-process check with `pnpm exec tsx packages/cli/scripts/sync-proof.ts /absolute/path/comb-bridge`. It creates two independent stores and daemon processes, invokes real CLI edits, observes a real editing-session event, checks duplicate append, denies the local backend during edits, restarts a daemon, restores access, and checks convergence plus an untouched idle copy. Output and a timestamped transcript stay in `.audit/sync-run-*/`. This is a one-machine integration check; cross-machine acceptance belongs to S5.
