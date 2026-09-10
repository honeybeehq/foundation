# Foundation verification map

Read the matching feature before driving it. The baseline is a fresh source-mode run with two real Electron clients, the Somewhere seed, one private local host/Comb backend, distinct replicas, and the same author. Run `doctor` first. All commands below run from the repo root with `$RUN` set as in [the skill](../SKILL.md). Short `C` commands in recipes mean the shell function:

```sh
C() { node packages/desktop/scripts/control-foundation.mjs "$@" --run "$RUN"; }
```

Commands run sequentially within a session. Add `--client b` for the second client. Label each entry point. Snapshots expose current selectors and values; `wait-state` verifies stored side effects; `restart` verifies persistence. Reports name the IDs actually exercised and list untested entry points. An action returning success is not a substitute for the recipe's assertions.

| Feature | Coverage and entry points |
|---|---|
| [Editing](editing.md) | Layer tree/assets/canvas selection, inspector text/geometry, text/rectangle insertion, undo/redo, saved reopen |
| [Comments](comments.md) | Comments dock, Activity, footer, C shortcut; post, resolve/reopen, show layer |
| [Sync and persistence](sync.md) | Offline saves, Connect/Reconnect, Sync now, Disconnect, two-peer convergence and reopen |
| [Canvas and appearance](canvas.md) | Layer search, tokens, zoom, preview, appearance, pointer/keyboard paths |
| [Document CLI and export](documents.md) | New, validate, bake, chain, render, native desktop Export; boundary with Apiary |

Only the supported persisted desktop vocabulary is covered: displayed text/images/buttons/rectangles and color tokens. Arbitrary documents, AI execution, JavaScript component authoring, responsive layout, and full prototyping remain later work; their explanatory dialogs are not successful execution of those features.

The automated `control-foundation-proof.mjs` covers inspector edits/undo/redo, comment post/resolve/reopen, two clients publishing through local Comb, per-client disconnect, persisted restart, and cleanup. It does not claim every entry point in this map. The older `packages/desktop/scripts/live-proof.mjs` additionally exercises a packaged app starting its own bundled host and generated local backend; use it for packaging/runtime changes. Neither local proof establishes two-machine networking or a remote backend outage.
