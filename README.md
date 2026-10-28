# Foundation

A methodology and technology for agent-first HTML design iteration: a closed-by-schema
HTML subset, a chain-of-changes truth model, first-class components, deterministic
rendering, and a canonical text projection that freezes into repos.

Foundation is three things:

- **A format:** `.fdn.html` documents and their `.chain` files.
- **A sync strategy:** the Loro change chain.
- **A service:** `foundation session`, which speaks the session protocol in
  [packages/protocol](packages/protocol).

Foundation has no app of its own. The editor is Apiary Next's Design panels
(`apps/next-desktop-beta/src/plugins/foundation` in `honeybeehq/apiary`), which talk to
`foundation session` over that protocol. The standalone desktop app is retired.

- **Spec:** [docs/SPEC.md](docs/SPEC.md) — the four one-way doors and the grammar skeleton
- **PRD:** [docs/PRD.md](docs/PRD.md) — the bet, the layers, the delivery plan

## Status

Pre-L1. Current work is the three de-risking spikes:

| Spike | Question | Where |
|---|---|---|
| Chain | Loro vs Automerge 3 as the change-DAG substrate (decided by the concurrency gauntlet) | [spikes/chain](spikes/chain) |
| Grammar | Does the proposed subset survive re-drawing real design boards? | [boards](boards) |
| Render | Are bit-identical cross-machine renders achievable, or is the honest contract layout-identical + pixel-tolerance? | [spikes/render](spikes/render) |

## Development

```
pnpm install
pnpm typecheck
pnpm test          # gauntlet + harness tests
pnpm spike:chain   # run the full chain gauntlet, writes spikes/chain/RESULTS.md
pnpm spike:render  # render determinism check, writes spikes/render/RESULTS.md
```

### Install the same Foundation on every node

Run `foundation install --from /path/to/foundation --sha <commit>` on Linux or
macOS (Node 22+, pnpm, Git and tar required). The installer archives that commit,
installs its locked dependencies and builds its session bundle once. Uncommitted
checkout edits are excluded. Releases live in
`~/.local/share/foundation/versions/<sha>`; `~/.local/bin/foundation` follows the
`current` release and the Hive MCP gateway uses that stable executable.
Installed sessions never rebuild from source mtimes. Use `--from` when upgrading
from an installed copy; the source must contain the requested commit. Revisions
that predate runtime attestation are refused rather than stamped with guessed
compatibility.

`foundation --version` and `foundation version --json` report the source SHA,
dirty state, package version, supported session protocols and document formats.
The session welcome and MCP server information carry the same runtime identity
(MCP version contains the SHA; description contains the complete JSON report).
`foundation doctor --inventory --json` reads executable/configuration candidates
on the current node without running or changing discovered copies; unknown
revision or format safety stays unknown.

Reinstalling a commit reuses its release. A non-descendant revision requires
`--force`. The installer prints the previous revision and a runtime-independent
`/bin/sh` rollback command. That command (or `foundation install --rollback`)
restores four activation paths: `current`, `previous`, `~/.local/bin/foundation`,
and the gateway registration (including its original bytes and permissions).
Restart existing agent sessions to pick up a changed MCP registration. Install
into a temporary `HOME` to test without changing the node's active Foundation.

Rollback does not erase install state. Both install JSON and `--dry-run` JSON
list it in `stateOutsideRollback`:

- `~/.local/share/foundation/versions/` retains releases and their dependencies.
- `~/.local/share/foundation/rollbacks/` retains private restore scripts and
  before/after file snapshots.
- `~/.local/share/foundation/rollback.json` holds the latest activation snapshot;
  successful rollback renames it to `rollback-restored.json`, which remains.
- `~/.local/share/foundation/rollback-active` holds the active restore token and
  is removed after successful rollback.
- `~/.local/bin/foundation.before-foundation-install` retains the original
  executable backup when one was needed, including after rollback. The gateway
  is saved in the rollback snapshots, not in a separate suffixed backup.
- `~/.local/share/foundation/install.lock` is a transient lock directory used by
  install and rollback, removed on normal exit; interruption can leave it behind.
  Confirm no install or rollback is running before removing a stale lock.
- `~/.foundation/machine-id` may be created by document lock-owner identification
  if no OS machine identity is available. It is persistent and outside rollback.

The installer uses Node's in-process TypeScript loader for version queries and
the launcher, so long `TMPDIR` paths do not require a tsx CLI IPC socket. Run
`python3 scripts/verify-install-hardening.py` from a checkout to exercise a real
temporary-HOME install, installed version query and rollback with a 100-byte
`TMPDIR`, without changing the active node installation.
