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
`--force`. The installer prints the previous revision and rollback command;
the original executable and gateway registration are retained with a
`.before-foundation-install` suffix. To restore the pre-install setup, move those
back to their original paths (remove the new executable symlink first). Restart
existing agent sessions to pick up a changed MCP registration. Install into a
temporary `HOME` to test without changing the node's active Foundation.
