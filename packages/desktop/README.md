# Foundation desktop

The accepted canvas study, connected to the Foundation host through a sandboxed Electron preload. The host owns SQLite, Loro history and Comb publication. The desktop sends granular edits and displays host receipts and sync state.

The app keeps the compact docked panels, one header, neutral gray chrome, light blue accent, appearance sliders and middle mouse panning. Comments and connection controls live in the right sidebar, opened through Comments, Activity or the save status.

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

## Editing and failure behavior

Text, geometry, color and token changes become engine `PatchOp` batches. Undo/redo sends inverse leaf edits; remote edits to unrelated fields survive. New layers use UUIDs. Images are bundled `assets/<hash>.jpeg` references, never image data in genesis.

The footer distinguishes saving, saved locally with pending changes, offline, paused, causal gaps and published/caught-up state. Connect, Disconnect, Reconnect and Sync now are explicit. Disconnect leaves local authoring available while the local host is running. Connected alone never means published.

A failed or timed-out save leaves its draft visible and stops further writes. Reload saved state rereads the host before discarding an unconfirmed draft. Mutations are never retried automatically. Closing with unconfirmed edits prompts the user. Comments receive IDs and local-save receipts from the host; resolve/reopen is another persisted engine operation.

Export uses the host's explicit HTML/chain export and a native directory picker. Static artboard decoration remains part of this design study; the current persisted editable vocabulary is the displayed text, images, buttons, rectangles and color tokens. AI execution, JavaScript components, responsive layout authoring and arbitrary document rendering remain later work; their UI controls explain that scope.

## Verification

```sh
pnpm typecheck
pnpm exec vitest run packages/desktop/test
node --test spikes/desktop-prototype/model.test.mjs
node packages/desktop/scripts/live-proof.mjs /path/to/Foundation.app /path/to/fresh-proof-directory
```

The live proof drives two actual Electron clients through the UI/preload, with one real host and immutable Comb bridge. It tests same-author offline edits/comments, pending-to-published convergence, per-session disconnect, restart of both replicas, then packaged standalone first launch and save/reopen. It writes screenshots, a result report and diagnostics under the chosen proof directory. Use a fresh directory per run. These are acceptance artifacts, not mock sync results.
