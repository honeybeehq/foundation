# Foundation desktop

The accepted canvas study, connected to the Foundation host through a sandboxed Electron preload. The host owns SQLite, Loro history and Comb publication. The desktop sends granular edits and displays host receipts and sync state.

The app keeps the compact docked panels, one header, and middle mouse panning, styled in the Apiary look: warm charcoal chrome (with a Paper light scheme), Hanken Grotesk and IBM Plex Mono, and a honey accent reserved for the brand mark, the appearance dot, and focus. Comments open through the dock, Activity, or the footer save status. Comments and connection controls live in the right sidebar.

## Development

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter foundation-desktop build
pnpm --filter foundation-desktop start --host-url http://127.0.0.1:PORT --host-token-file /private/path/host-token --replica-dir /private/path/replica-a --doc-id shared-document --author user:designer
```

The host service prints its loopback URL and token file path on startup. `FOUNDATION_HOST_TOKEN` is also supported. Credentials and host configuration stay in the main process. Use the same host URL/document ID and a different replica directory for another app instance. The author may be identical. The host supplies canonical genesis to every fresh replica.

Without `--doc-id`, main generates and persists a document ID in the replica's `.desktop/document.json`. Without `--replica-dir`, it uses the default user data replica. `--recover` opens without a seed for recovery from an existing feed. A replica with no document can connect but cannot edit until recovery completes.

## Packaging on macOS arm64

The host owner builds a self-contained directory containing `service-main.mjs` and its runtime dependencies. The desktop package copies that directory, the accepted immutable Comb bridge and an official Node 24 executable. It never copies a backend configuration or credentials.

```sh
node packages/desktop/scripts/download-node.mjs
pnpm --filter foundation-desktop build
node packages/desktop/scripts/package.mjs \
  --host-bundle /path/to/built/host \
  --node-bin packages/desktop/.runtime-downloads/node-v24.20.0-darwin-arm64/bin/node \
  --comb-bin /path/to/accepted/comb-bridge \
  --output packages/desktop/release/Foundation.app
```

Choose a new output path for each package. The script verifies the Node version/system dependencies and accepted Comb hash, preserves relative framework links, and signs the app locally. Distribution signing/notarization is separate.

Opening the packaged app without a host URL starts its bundled Node/host sidecar. On first launch it creates a private local Comb configuration and random digest key in writable user data. Existing keys are preserved. Local objects, SQLite files and auth tokens stay outside the app. An explicit `--comb-dir` can point to an operator's existing backend configuration. The sidecar lives with the app process, independently of Apiary terminal tabs.

For a manual two-client session, with no automated edits:

```sh
node packages/desktop/scripts/open-two-clients.mjs /path/to/Foundation.app /path/to/new-session-directory
```

This leaves two editable windows sharing a document and host, with independent replica directories and the same author. Open Comments & sync to connect each client after making offline edits. Ctrl-C stops the clients and host; their saved replicas remain in the session directory. The launcher refuses an existing session directory and prints no credentials. Keep its process running for the session. Direct-opening the app remains the independent standalone option.

The package also includes this launcher. To run it without a repository or system Node installation:

```sh
"/path/Foundation.app/Contents/Resources/host/bin/node" \
  "/path/Foundation.app/Contents/Resources/open-two-clients.mjs" \
  "/path/Foundation.app" "/path/to/new-session-directory"
```

## Editing and failure behavior

Text, geometry, color and token changes become engine `PatchOp` batches. Undo/redo sends inverse leaf edits; remote edits to unrelated fields survive. New layers use UUIDs. Images are bundled `assets/<hash>.jpeg` references, never image data in genesis.

The footer distinguishes saving, saved locally with pending changes, offline, paused, causal gaps and published/caught-up state. Connect, Disconnect, Reconnect and Sync now are explicit. Disconnect leaves local authoring available while the local host is running. Connected alone never means published.

A failed or timed-out save leaves its draft visible and stops further writes. Reload saved state rereads the host before discarding an unconfirmed draft. Mutations are never retried automatically. Closing with unconfirmed edits prompts the user. Comments receive IDs and local-save receipts from the host; resolve/reopen is another persisted engine operation.

Export uses the host's explicit HTML/chain export and a native save dialog to choose a new folder name. The host creates that destination and refuses any existing path. Static artboard decoration remains part of this design study; the current persisted editable vocabulary is the displayed text, images, buttons, rectangles and color tokens. AI execution, JavaScript components, responsive layout authoring and arbitrary document rendering remain later work; their UI controls explain that scope.

## Verification

```sh
pnpm typecheck
pnpm exec vitest run packages/desktop/test
node --test spikes/desktop-prototype/model.test.mjs
node packages/desktop/scripts/live-proof.mjs /path/to/Foundation.app /path/to/fresh-proof-directory
```

The live proof drives two actual Electron clients with DOM clicks and input events through their existing UI handlers and preload, with one real host and immutable Comb bridge. It asserts selection, field contents, enabled controls and local-save acknowledgments. It does not call host mutation endpoints directly. Physical pointer targeting is covered separately by the prototype smoke test; this data acceptance avoids shared-desktop focus interference. It tests same-author offline edits/comments, pending-to-published convergence, per-session disconnect, restart of both replicas, then packaged standalone offline save, Connect through its generated local Comb backend, and reopen. It writes screenshots, bundled executable hashes, a result report and diagnostics under a fresh proof directory; existing directories are refused. Success requires observed clean exits from every app and the external host. A failed or timed-out teardown remains a failed report. These are acceptance artifacts, not mock sync results.

## Reusable control surface

Use the repository-local [verify-foundation skill](../../.claude/skills/verify-foundation/SKILL.md)
and its [feature map](../../.claude/skills/verify-foundation/features/README.md) for targeted
verification. `pnpm control help` lists the JSON CLI: launch, doctor, UI click/fill/select,
keyboard input, snapshots, stored-state assertions, screenshots, client restart, and cleanup.

```sh
pnpm control launch --run .artifacts/verification/my-task \
  --runtime "$HOME/Applications/Foundation.app/Contents/Resources/host" --clients 2
pnpm control doctor --run .artifacts/verification/my-task
pnpm control snapshot --run .artifacts/verification/my-task
pnpm control cleanup --run .artifacts/verification/my-task
```

Source mode rebuilds this checkout's desktop and uses the explicitly supplied real host
runtime. `--app /path/to/Foundation.app` instead verifies that packaged renderer. Every run
owns a private local Comb backend and independent replicas. The default interaction uses
DOM events through the existing UI handlers; `--input pointer` on click/fill tests Playwright
input targeting. Native dialogs and canvas gestures require separate UI verification.

For a remote backend, point two independent runs at one Comb configuration. Each run keeps its
own host process and replica; only the object store is shared. `combctl init --backend s3` with an
`--endpoint` produces a MinIO-compatible configuration; its credentials come from the AWS profile
it names, and the file is copied into the run's scratch state, never into evidence.

```sh
pnpm control launch --run .artifacts/verification/remote-a --app "$HOME/Applications/Foundation.app" \
  --comb-config "$HOME/Library/Application Support/Foundation/remote-minio/config.toml" \
  --doc-id remote-test-1 --author user:a
pnpm control launch --run .artifacts/verification/remote-b --app "$HOME/Applications/Foundation.app" \
  --comb-config "$HOME/Library/Application Support/Foundation/remote-minio/config.toml" \
  --doc-id remote-test-1 --author user:b --recover
```

The first run seeds the document and publishes it after Connect. The recovering run opens an empty
replica; its Connect adopts the published genesis and every later change. Publication holds a
single publisher lease per log, so a second host's appends pause with `deadline_exceeded` while
another host stays connected; Disconnect the first host, then Reconnect the second.

Actions, snapshots, stored states, screenshots, build fingerprints, and lifecycle exits
remain under the run's `evidence/` directory. Cleanup closes the processes owned by that
run and moves scratch state to its `.trash/` directory. It never deletes proof artifacts.

```sh
pnpm test:control
node packages/desktop/scripts/control-foundation-proof.mjs \
  "$HOME/Applications/Foundation.app/Contents/Resources/host" \
  .artifacts/verification/control-acceptance
```

The latter drives the public control CLI end to end, asserts two-peer offline edits,
comments, publication, undo/redo, restart persistence, and clean teardown, and retains
`evidence/control-proof.json`. Existing proof directories are refused.
