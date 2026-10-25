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
actual registered local copies. A remote record never has an invented absolute path.
`freshness` is `{state:'starting'|'fresh'|'stale',lastContactAt:number|null,reason:string|null}`.
Revision changes with rows and meaningful status, not successful contact alone.
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
services without the SSE source tag produce conservative baseline facts. Hash
dedup is persisted per DesignRef across local copies. After the initial snapshot,
even an empty one, a control row `{version:1,type:'ready',workspaceId,cursor}` marks
local journal catch-up; it is not service contact or presence. A stale cursor exits
2 with a visible baseline instruction. The local journal retains 10,000 fact rows.

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
