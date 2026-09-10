---
name: verify-foundation
description: Launch and drive Foundation's real Electron desktop and document CLI to verify edits, comments, sync, persistence, and canvas behavior. Use for Foundation runtime verification, feature demos, or proof after a desktop/engine change. Uses control-foundation and a maintained feature map.
---

# Verify Foundation

Use `packages/desktop/scripts/control-foundation.mjs` from the repository root. The `.agents/skills/verify-foundation` symlink points to this same skill for Codex discovery. Read [the feature index](features/README.md), then the recipe for the affected feature. Extend the control CLI when a real interaction is missing; keep reusable automation out of scratch CDP scripts.

The desktop is the primary surface. The document CLI and the Apiary design-board integration are separate entry points: a desktop pass does not prove them. The source checkout contains the desktop and document engine; the real host/SQLite/Comb runtime is supplied by a built Foundation app. Source mode rebuilds this checkout's desktop on every launch. Package mode explicitly tests the package, which can be older than this checkout. No mocked host, direct mutation endpoint, or internal editor setter is used.

## Launch

```sh
pnpm install --frozen-lockfile
# Noninteractive installation: CI=true pnpm install --frozen-lockfile
# If Electron was installed before its build permission: pnpm rebuild electron
RUN="$PWD/.artifacts/verification/$(date +%Y%m%d-%H%M%S)-$$"
RUNTIME="$HOME/Applications/Foundation.app/Contents/Resources/host"
node packages/desktop/scripts/control-foundation.mjs launch --run "$RUN" --runtime "$RUNTIME" --clients 2
```

Ready means JSON `ok: true`, `session.phase: ready`, two distinct `replicaId`s, and the source/runtime fingerprints. Each run gets a private directory, fresh document ID, independent replicas, a random loopback control port, and its own real host with a local Comb object store. Connect publishes only into that run's local backend. No operator Comb configuration is reused. Desktop windows are visible. The content viewport is emulated at 1440×900 so window-manager retiling does not change screenshots; this does not assert native window bounds. DOM mode avoids physical focus interference but is not proof of pointer targeting.

If the runtime is missing, use an explicitly supplied built runtime or follow [desktop packaging](../../../packages/desktop/README.md). Do not substitute a mock or an installed renderer for a changed source renderer. Host/engine/SQLite/Comb changes require a newly built runtime and checking its reported hashes. The control CLI does not build those sibling repositories.

For package acceptance instead:

```sh
node packages/desktop/scripts/control-foundation.mjs launch --run "$RUN" --app "$HOME/Applications/Foundation.app" --clients 2
```

Existing run directories are refused. A failed launch retains diagnostics and attempts owned-process teardown. Never reuse its directory. Teardown is `stop` or `cleanup` below. Do not launch two source builds while editing the shared checkout; their replicas are isolated but their build output is shared.

## Doctor

```sh
node packages/desktop/scripts/control-foundation.mjs doctor --run "$RUN"
```

Require `ok: true`. This read-only probe checks the live owner connection, host process, exact renderer URL, document/replica identities, editable session, desktop source/build freshness, runtime fingerprints, and recorded renderer errors. Source changes after launch require stop and a fresh launch. `gitHead` alone is insufficient: uncommitted source and built bytes are fingerprinted too. A dead owner is an error, never permission to signal a recorded PID; inspect `session.json` and `evidence/owner.log` and establish current process ownership before recovery.

## Drive

Use the CLI directly (portable to zsh; do not put a multiword command in a scalar):

```sh
node packages/desktop/scripts/control-foundation.mjs help
node packages/desktop/scripts/control-foundation.mjs snapshot --run "$RUN" --label editing-layer-before
node packages/desktop/scripts/control-foundation.mjs click '#layer-tree [data-select="heading"]' --run "$RUN" --label editing-layer-select
node packages/desktop/scripts/control-foundation.mjs fill '#text-content' 'VERIFY Foundation headline' --run "$RUN" --label editing-inspector-fill
node packages/desktop/scripts/control-foundation.mjs wait-state document.body.0.children.0.text '"VERIFY Foundation headline"' --run "$RUN" --label editing-saved
node packages/desktop/scripts/control-foundation.mjs restart --run "$RUN" --label editing-reopen
node packages/desktop/scripts/control-foundation.mjs screenshot --run "$RUN" --label editing-reopened
```

`--client b` selects the second client; default is `a`. `viewport 480 844` changes the emulated content size for responsive checks; restart restores 1440×900. Selectors must match exactly one visible, enabled element. `fill` checks editability, dispatches input/change, verifies the field value, then blurs. `select` changes a dropdown through its real UI event. Default `--input dom` sends DOM events through production UI handlers/preload. `--input pointer` on click/fill uses Playwright targeting. `press` always uses Playwright keyboard input; focus matters. Native save dialogs require OS UI driving; report that path separately. The CLI dismisses JavaScript dialogs (for example discard confirmation), so it cannot silently approve discarding an unconfirmed draft.

`wait` asserts visible text contains a value. `wait-state` asserts an exact JSON value at a dot-separated path in the read-only host state, including array indices. Read `state` before selecting an index outside the seed document. Use `restart` after saved-state assertions; it requires the same document and replica identity across a real process restart. A connected peer can receive new edits during restart, so stop editing other clients first.

## Evidence

`$RUN/evidence/` survives teardown. Actions append started/completed/failed records to `actions.jsonl`; numbered artifacts contain before/after ARIA trees, visible controls, stored host state, and an after screenshot. Failures attempt a screenshot too. `session.json` and `evidence/lifecycle.json` identify the build, processes, exit acknowledgments and lifecycle errors. A successful dispatch alone is not feature proof: require the exact visible result and independently read stored state. For persistence, restart and reread; for collaboration compare both complete documents and both replica IDs.

Name the feature and entry point with `--label`. Include the action and result, not just a final picture. Preserve failed attempts and report skipped entry points. DOM event acceptance does not prove physical hit targets, native dialogs, two-machine delivery, a remote backend outage, or packaged standalone host startup. The existing `live-proof.mjs` covers packaged standalone startup and two-peer data acceptance; see the feature index.

Artifacts may contain document content. The control token and private backend key remain outside evidence. Keep all verification artifacts uncommitted. In Apiary, show useful screenshots as `![caption](.artifacts/verification/.../evidence/...png)` and open a changes/commit card for the code handoff; use live `self` and `setup` first.

## Cleanup

```sh
node packages/desktop/scripts/control-foundation.mjs stop --run "$RUN"
node packages/desktop/scripts/control-foundation.mjs cleanup --run "$RUN"
test -f "$RUN/evidence/lifecycle.json"
test -f "$RUN/evidence/actions.jsonl"
```

Stop closes only app/host handles held by this run's owner and requires observed clean exits. Timeouts trigger a forced stop and a failed lifecycle result. Cleanup then moves scratch state into `$RUN/.trash/scratch` (recoverable POSIX trash); evidence stays in place. It is safe to repeat stop/cleanup after successful teardown. Run cleanup after failed iterations too; a failed lifecycle stays failed and its scratch state is kept for diagnosis. Never kill by process name or remove the evidence directory.

## Helpers

The executable `control-foundation.mjs` is the reusable control surface; `pnpm control help` is an alias. Run `pnpm test:control` for its contract checks, `pnpm typecheck`, and `pnpm exec vitest run packages/desktop/test --maxWorkers=1` for desktop logic. The executable [control proof](../../../packages/desktop/scripts/control-foundation-proof.mjs) exercises two clients through this CLI and retains its report:

```sh
node packages/desktop/scripts/control-foundation-proof.mjs "$RUNTIME" "$RUN"
```

Use a fresh `$RUN` for the proof. It launches and cleans up itself on success or assertion failure. If the helper process is interrupted, run `cleanup --run "$RUN"` explicitly; the session owner intentionally survives individual CLI processes. Run `/maintain-verification-skill` when routes, controls, host contracts, or feature scope drift.
