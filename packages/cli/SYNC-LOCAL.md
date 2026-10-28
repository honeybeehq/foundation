# Local catalogue, activity and materialization

These commands are for the local apiaryd. Catalogue/activity reads use private,
rebuildable daemon-owned files, never a share-service request or a vault lookup.
Run `foundation sync serve` first. Use the same state environment for the daemon
and its readers; no panel or renderer contacts storage.

```
foundation sync catalogue --workspace W --json [--repo-root ROOT]
foundation sync activity --workspace W --follow --json [--cursor TOKEN]
```

Catalogue JSON is `{version:1, records, localReplicas, revision, freshness, errors}`.
Records retain the version-1 CatalogueRecord fields in SYNC.md, folded by
workspace/product/docId/originNode.id/replicaId with monotonically increasing
generations. Tombstones remain explicit per-replica records. Missing rows, failed
reads, closing a design and stale service contact never imply deletion. Unsupported
records and invalid paths are quarantined with bounded errors; valid rows remain.
`localReplicas` contains `{workspaceId,productId,docId,path,repoPath,headHash}` for
actual registered local copies. A remote record never has an invented absolute path. Any authorized repository
writer can claim catalogue metadata for another replica: the catalogue is a
discovery hint, never document truth or proof that a named machine authored it.
`freshness` is `{state:'starting'|'fresh'|'stale',lastContactAt:number|null,reason:string|null}`.
Revision changes with rows and meaningful status, not successful contact alone.
Quarantine messages remain bounded diagnostics, not failed connection contact.
Only currently followed repositories contribute to the contact minimum; stopped
repo caches remain available without pinning unrelated active repos stale.
`lastAgentEdit` remains null until authenticated agent provenance is available.

Activity is NDJSON. Facts contain `{version:1,cursor,document,repo,source,originNode,
originAssurance,signatureVerified,entry,delivery,observedAt}`. `document` is
`{workspaceId,productId,docId,ownerNodeId}`; the owner is the observed local replica,
not writer identity. `source:'import'` means a known transport entry into this
chain; `source:'local'` means locally observed/published, including unknown cold
history, and does not prove authorship. `entry` is the engine ChainLogEntry with
hash, author/message, nodeIds, nodes.inserted/removed/changed, optional artboardIds
and pageIds, sections, factsComplete, wallTime and boardKeys (empty if unavailable).

Only a verified member-device signature preserves the hashed originNode claim,
with `originAssurance:'writer-stated'`; otherwise originNode/assurance are null.
It is a display/routing hint, never machine attestation or authorization. Writers
can set FOUNDATION_ORIGIN_NODE; otherwise the existing engine caller uses hostname.
Never replace it with ownerNodeId. wallTime is historical metadata; consumers use
their receive time for observation leases.

Cold/resumed stream backlog is always baseline. A live fact requires a fresh
ephemeral hint while caught up; durable replay/outbox recovery is baseline.
Startup history is not hinted, and queued hints expire after two seconds. Older
services without the SSE source tag produce conservative baseline facts. The tag
is service-stated transport timing, not a signed proof of freshness; a service can
delay unseen changes. Persistent hash dedup still prevents a known hash renewing
a lease. Hash
dedup is persisted per DesignRef across local copies. After the initial snapshot,
even an empty one, a control row `{version:1,type:'ready',workspaceId,cursor}` marks
local journal catch-up; it is not service contact or presence. A stale cursor exits
2 with a visible baseline instruction. The local journal retains up to 10,000 fact rows in append-only segments. A
separate append-only hash index preserves dedup after payload eviction; the recent
seen cache and pending queue are bounded at 10,000. Imports only enqueue metadata;
queued 20ms flushes process at most 32 facts per turn, prioritizing fresh live facts.
Observations delayed over five seconds are baseline. Only a published, fsynced
index advances the resume cursor. Unflushed observations after a stop/crash are
reconstructed from the saved chain as baseline, never replayed as fresh leases.

## Explicit materialization

```
foundation sync materialize DOC_ID [TARGET_REL] --repo-root ROOT --workspace W --product P \
  --repo-relative-path REL --expected-head HASH --request-key KEY --json --accept
foundation sync materialize-status KEY --json
foundation sync verify FILE --doc-id DOC_ID --expected-head HASH --json
```

`--source-replica ID` is optional with an explicit target. `--entry FILE` can supply
docId, workspaceId/productId, repoRelativePath, replicaId, headHash/expectedHead and
requestKey. `--accept` durably queues locally and returns
`{version:1,state:'accepted',requestKey}` before network/history work. Status returns
pending, ready or refused. Ready includes workspaceId/productId/docId, path,
repoPath, headHash and requestKey; refused includes code/message and optional path.
Transient transport/setup failures use code `unavailable`, distinct from
`history-unavailable` for missing retained history. Refusals settle permanently;
a user retry supplies a new key, with no uncancellable background writes.
Repeating the same key/request is idempotent; using it for another request refuses.
Without `--accept`, the existing blocking command returns ready/refused directly.

The daemon decrypts and verifies full history before saving a confined .fdn.html
replica. It never clones, overwrites a foreign/untracked design or invents a new
genesis. Matching complete local history containing the requested head can fulfill
an explicit request offline (`fromCache:true`). An unavailable Product checkout is
`product-unavailable`; absent history is `history-unavailable`; path conflicts stay
typed. Share config uses modes self-hosted/hosted with e2e-v1; no file/git-only is
not live sharing. `--comb-config FILE` retains the explicit development transport.

`sync verify` is nonlocking and read-only. It checks HTML/chain/expected docId and
chain integrity/head membership, returning
`{version:1,state:'verified',docId,headHash,path,containsExpectedHead:true}` or
`{version:1,state:'refused',code,message}` (exit 1). It never repairs or registers.

## Isolated source runs

In an owned temporary Foundation checkout, `pnpm install --frozen-lockfile`, then
run `node --import tsx /ABS/CHECKOUT/packages/cli/src/main.ts ...` from that checkout.
This is a source runtime, not an installed capability stamp or a fleet upgrade.
Keep HOME unchanged. Set absolute FOUNDATION_REPLICA_STORE and
FOUNDATION_SHARE_STATE_DIR to task-owned directories. Share state is private0700,
with Linux vault/recovery files0600; relative paths and symlink state roots refuse.
On macOS also set FOUNDATION_SHARE_KEYCHAIN to a private scratch Keychain and use
the native Keychain implementation; state-dir alone does not isolate the default
Keychain/account. Set FOUNDATION_NODE_ID to the real local replica owner id, and
FOUNDATION_ORIGIN_NODE for the writer's chosen machine label.

State isolation validates the final state-root component and private modes. Ancestor
path ownership/resolution belongs to the local OS/account trust boundary; it does
not defend a compromised local account or maliciously substituted parent path.

## Immutable image assets

Live sharing carries document-relative `.foundation/assets/<sha256>.<ext>` files
alongside changes. The path is relative to the containing design directory;
accepted extensions are png, jpg, gif, webp, avif and svg. Each file is at most
20 MiB. Plain Git still carries these ordinary repository files. No asset GC is
performed: retained, unreferenced image files are uploaded too, preserving undo.

The client streams 128 KiB chunks through existing signed XChaCha20-Poly1305
records. Each chunk has its own keyed/opaque physical feed; content SHA, extension, size, chunk
index/count and bytes stay inside authenticated ciphertext. Existing AD binds the
opaque asset feed, epoch, key id and keyed chunk identity; the feed address also binds the content identity and chunk index, and the encrypted signed
header binds the total. Dedup is keyed per epoch. No custom
crypto or separate service storage keys are introduced.

Receivers validate the candidate chain and attempt missing current images for at
most200ms before importing the consistent change. The writer likewise isolates
image upload failures rather than blocking later text edits. Local
`sync status --json` rows expose `assets: [{path,state,reason}]`, with pending,
error or ready per document-relative path. The daemon retries failed images every
five seconds even while no new edits arrive. The Inspector already shows “Not on
this computer yet” for missing stored images; the canvas retains native image
alt/broken-image or missing background until reload. A richer transport overlay
belongs to Apiary. No fake content-hash files or altered document references are
used as placeholders. CLI bake/render/export cannot claim success for a missing
image; they must keep their strict checks.

Before any image is installed, clients verify sequence, bounded length, full
SHA256 and image signature. Installation never overwrites. Materialization waits
for verified current images (bounded60s); otherwise it refuses visibly rather
than reporting a falsely complete export. Materialization into another directory
brings current images there, including from complete local cache while offline.
Historical blobs remain available for later undo references; materialization does
not eagerly fetch every historical image. A corrupt pre-existing immutable local
file is refused and preserved for inspection, never silently replaced. Asset-like
prose and names outside the exact content-addressed contract are ignored. SVG
DOCTYPE prologs are accepted, but ENTITY declarations are refused across the
whole file.

There are at most two active transfers and32 queued per client process. Temp
files are exclusive, removed on failure, and dead-owner temps are cleaned on the
next fetch in that directory. A live owner or reused PID is never cleaned up.
Changes without assets keep their independent transport. Legacy explicit Comb
config retains its existing development behaviour; asset transport requires
per-repo encrypted sharing.

SVG bytes are not rewritten or trusted as sanitized by sync. A buggy or malicious
member can share arbitrary SVG bytes. **Every receiver must display SVG only in
an image context (`img src` or CSS image URL), never inline DOM, object or embed.**
A future consumer that inlines SVG must sanitize on read first. The Design pane
owner confirms image-context rendering; writer-side ingestion sanitization is
additional protection, not the receiver's security boundary.

Asset metadata residuals: a former member retaining the routing key can compute
feed names for a known image hash; with service cooperation they can confirm its
presence even after access is removed. The service alone cannot compute those
names. Chunk framing/timing exposes length at roughly128KiB granularity, and
retention is forever (no GC or storage reclamation). A repaired upload is read
newest-first with at most eight authenticated alternatives per chunk; malicious
member-written content can still deny an asset, but never blocks document sync.
Each chunk uses a lightweight share bridge object; authorization/key checks still
run for each request. No asset-throughput or cross-host latency SLO is claimed.

Automatic registration during session startup or a completed CLI edit writes a
local registration record without taking the document lock or modifying the
chain. This record is the daemon's queue: before publishing, its worker takes
the normal lock, checks the document identity and upgrades storage if needed.
The worker retries a busy document; the session/edit does not wait for sharing.
Before that worker has a checkpoint, `sync status --json` reports
`status: "sharing pending"`. Startup errors remain visible in `lastError`.
Explicit `sync open` still performs its synchronous format upgrade and can
report genuine contention. Closing a registration and later editing reopens it.

History entries from `foundation chain FILE log --json`, session `log`, and
incremental session `activity` expose `originNode: string | null` and
`originAssurance: 'writer-stated' | 'local' | null`. The node is the existing
hashed envelope claim, including for old or unsigned history. It is a display
label, never authorization or machine attestation; legacy values may be hostnames
rather than node inventory IDs. Assurance is `writer-stated` only after this
machine verified a member-device signature on that exact change. It is `local`
when the actual local writer committed it; matching origin/author text cannot
create local assurance. Unknown assurance is null. Local assurance takes
precedence for this machine's own changes.

Private append-only hash receipts under the replica store survive activity
journal payload eviction and process restart. They are observer metadata, not
chain/envelope fields, and are not sent to the share service or committed to git.
A plain git copy on another machine therefore keeps the raw node but has unknown
assurance until locally observed verification. Missing/unreadable observer state
fails closed to null and never fails an edit. S7 live facts retain their existing
outer NodeRef and verified-only origin rules; their entry has the same explicit
writer-stated/null assurance. Baseline/outage replay remains baseline and does
not renew presence leases merely because History can display its machine.

Receipts describe verification at observation time. Later membership loss does
not erase that historical display assurance or authorize any new write.

An absent local activity index is a valid cold start: reads return an empty
baseline and follow emits the usual ready control without creating any state
files. Its cursor is opaque. If the daemon later creates a real journal, the
follower emits the caught-up records as baseline, then another ready control
with the real cursor. Only subsequent new observations can be live. An invalid
cursor, a real index disappearing after a real cursor, a corrupt index, missing
segments and permission failures remain errors, rather than empty success.

History-origin receipts are append-only and currently never pruned (about66
bytes per assurance record, before directory/filesystem overhead). This retains
display provenance after activity payload eviction; operators should include
the private replica state in their normal local disk retention planning.

## Automatic registration and discovery boundaries

A writable session hello or local editing hook can register a design for sharing
when a nearby `.foundation/share.json` enables sharing. Set
`FOUNDATION_SYNC_AUTO_OPEN=0` to disable automatic registration, including that
share-config fallback. An unset value keeps share-config discovery; `1` opts in
without requiring a share config. Explicit `foundation sync open` remains an
explicit registration request. This setting does not unregister existing copies;
use `foundation sync close FILE` to close an already registered copy.

Share-config discovery checks the starting directory, then walks upward until
it finds a share config or Git root. It never walks above `HOME`, or enters an
ancestor listed in `GIT_CEILING_DIRECTORIES` (using the platform path-list
separator, `:` on Linux/macOS). Paths and ceilings are resolved through symlinks.
An explicitly selected `--repo-root` does not perform this discovery walk.
