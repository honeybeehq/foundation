# Offline edits, publication, and reopen

Work offline, explicitly connect to publish saved changes, and see both clients converge without losing independent edits or comments.

## Sub-features

- `sync.offline`: local save with pending publication is shown honestly.
- `sync.publish`: Connect/Sync now produce zero pending and caught-up status.
- `sync.merge`: both clients retain edits/comments and converge to identical documents.
- `sync.disconnect`: disconnect affects only one client.
- `sync.restart`: a restarted client retains document and replica identity.
- `sync.failure`: errors remain visible; unconfirmed drafts are not silently discarded.

## How to get to it (user POV)

Open Comments & sync through the dock, Activity, save-status footer, or C. Use Connect (Reconnect when already connected/error), Disconnect, and Sync now. The footer distinguishes saved locally, pending, offline, paused, causal gaps, and Published. Reload saved state appears after a host/save failure.

## Driving it with control-foundation

Preconditions: baseline with `--clients 2`, both disconnected, same document/author and distinct replicas. Complete the editing/comment recipes separately on A and B; use heading on A and mobile-heading on B.

- Offline edits: `C click '#layer-tree [data-select="mobile-heading"]' --client b`; `C fill '#text-content' 'VERIFY mobile headline' --client b --label sync-offline-b`; `C wait-state document.body.1.children.0.text '"VERIFY mobile headline"' --client b`. Both states must show pending > 0 and connection disconnected; both footers must say Saved locally and Offline.
- Publish: open each Comments pane, then `C click '#connect-host' --label sync-connect-a` and `C click '#connect-host' --client b --label sync-connect-b`. For each client run `C wait-state status.pending 0`, `C wait-state status.sync.kind '"caught_up"'`, and `C wait '#save-status' 'Published'` (add `--client b` for B). Require both texts and both unique comments in both complete documents, not merely connected status. The reusable proof helper performs deep equality.
- Explicit sync: `C click '#sync-host' --label sync-now`; require caught-up and zero pending again. `#connect-host` becomes Reconnect after connection; exercising it must preserve saved state.
- Per-client disconnect: `C click '#disconnect-host' --label sync-disconnect-a`; `C wait-state connection '"disconnected"'`; B must still report `"connected"`.
- Reopen: stop concurrent editing, then `C restart --label sync-reopen-a` and `C restart --client b --label sync-reopen-b`. Each checks its complete saved document and original replica ID. Reopened clients start disconnected; publishing again is explicit.
- Failure observation: if an operation fails, capture `snapshot`, `state`, and runtime.log. Record the draft and host state before clicking `#reload-saved`; the CLI dismisses discard dialogs. Native confirmation and controlled host/backend outage injection are not automated by this control surface.

- Remote backend: launch two separate runs with the same `--comb-config <config.toml>` (an S3/MinIO Comb configuration from `combctl init --backend s3 --endpoint ...`) and the same `--doc-id`; give the second `--recover`. Its footer starts as `Empty replica · Connect to recover document`; after `C click '#connect-host'` require `status.sync.kind` `"caught_up"` and the first run's edited text. Close the pane with `#design-mode` before inspector edits. A second host's append pauses with `deadline_exceeded` while the first host holds the publisher lease: `#disconnect-host` on the first, then `#connect-host` (Reconnect) on the second, then require zero pending on the second and the second's text on the first.

## Gotchas

Default runs use real Comb with a private local backend. This proves local adapter/merge behavior, not remote credentials, two-machine networking, backend outages, or ambiguous remote acknowledgments. The `--comb-config` recipe above adds a real remote object store and two independent hosts, still on one machine. Disconnect only pauses publication; local editing still requires the host. Connected alone is insufficient. `restart` restarts a client, not the host; a full host restart/recovery claim needs a separate acceptance path. For a packaged app starting its own host, run the existing `live-proof.mjs` with a fresh proof directory.
