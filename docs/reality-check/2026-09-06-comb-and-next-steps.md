# Foundation, Comb, and the next delivery milestone

Assessment date: 2026-09-06. Foundation at `bcb4c6c`, Comb at `8674fe4`.
This is a proposal and a bounded source assessment, not a change to the specification.

## Verdict

Adopt Comb as the intended remote persistence and distribution backend for Foundation.
Keep Foundation's document semantics, Loro merge model, portable exchange format, and
headless engine independent. Foundation is a good product consumer of Comb because
its changes are already immutable blobs and its projections are derived data.

The next milestone should demonstrate one shared board across two independent peers,
including offline edits, comments, reconnection, and recovery on a fresh machine.
First fix a reproduced annotation collision. Comb cannot repair application-level
data loss. Avoid making this milestone depend on Comb Tree, Volume, a standalone
Foundation app, or the complete hosted Comb service.

## Evidence and current state

Paths without a repository prefix are relative to Foundation. `comb/` below refers to
the sibling Comb repository. Apiary findings refer to the local checkout at
`/Users/trmd/Projects/trmd/apiary/repos/apiary`, not a verified running installation.

| Claim | Status | Evidence |
|---|---|---|
| Independent peers can exchange immutable changes and merge | Verified within the local exchange contract | `packages/engine/src/chain/exchange.ts:186`; `packages/engine/test/chain-exchange.test.ts:75` exercises divergent peers and directory exchange |
| Annotations have real chain-backed write paths | Verified by source inspection | `packages/cli/src/commands/annotate.ts:63`; `packages/engine/src/serve/index.ts:510`; MCP tools also expose create and status changes |
| Independently created comments survive concurrent merge | Broken | `packages/engine/src/chain/model.ts:294` mints `a<max+1>`; direct execution on two forks produced two `a1` IDs and one surviving comment |
| The dedicated Apiary board workflow is complete | Partial | `apiary/apps/desktop/src/main/foundationHost.ts` and `FoundationBoardPane.tsx` implement serving, state navigation, chain entries, and annotations; history entries at pane line 331 are display-only; no historical preview or structural comparison controls in the inspected pane |
| Foundation automatically syncs boards across machines | Missing in the inspected Foundation paths | `packages/cli/src/commands/chain.ts:284` implements explicit directory push, pull, and sync; there is no Comb adapter or continuous remote sync lifecycle |
| Product documents inherit a shared design system | Missing | `docs/SPEC.md:276` leaves semantics open; `packages/cli/src/project.ts:38` reserves the manifest field without implementing inheritance |
| Comb is ready as a production Foundation backend | Partial | Core objects, refs, and Log exist; `comb/crates/combctl/src/log.rs:89` lacks operation-ID admission; reads collect frames; follow propagates transient errors; pins and service SDK boundaries remain incomplete |
| Current cross-machine renders satisfy the render contract | Unverifiable in this session | `docs/SPEC.md:304` records prior cross-machine evidence and outstanding font fixtures; no fresh two-machine render was performed |

Counts: 2 verified, 2 partial, 2 missing, 1 broken, 1 unverifiable.
These counts describe the eight sampled claims, not total project completion.

Build on the engine, Loro integration, CLI/MCP tools, importer, and existing Apiary
pane. Rework peer-safe identity and transport boundaries. Retire the roadmap assumption
that Apiary must build Foundation-specific durable replication. No engine rewrite is
justified by Comb's arrival.

Both READMEs understate implementation. Foundation still says pre-L1; Comb says no
implementation. Foundation's Phase C epic also lists missing annotation commands and
JSON endpoints that now exist. The existing nightly QA reports are useful historical
evidence, but unchanged boards do not prove collaboration works.

## Proposed ownership

| Owner | Responsibility |
|---|---|
| Foundation | Grammar, validation, semantic changes, Loro merge, authorship, annotations, projections, rendering, freeze, design-system policy |
| Foundation sync client/service | Local outbox, upload/download, peer identity, document authorization checks, retry, deduplication, checkpoints, and sync status |
| Comb | Durable objects, conditional publication through refs or log manifests, tenant storage boundaries, recovery and retention mechanisms |
| Apiary | Board discovery and review UI, account/workspace context, local sync lifecycle, presence display |
| Optional Pheromone hints | Notify followers sooner; reconciliation must still work when every hint is lost |

Comb's per-ref or per-log writer ownership applies to publication. It must not prevent
two Foundation authors from editing offline. Loro's causal relationships determine
document merge. A Comb sequence is a delivery cursor, not a replacement document clock.
Presence and cursors are transient and need not enter durable document history.

Keep Foundation envelope hashes as portable SHA-256 identities. Map them to Comb's
tenant-keyed object digests in the adapter. Do not change Foundation identity to match
Comb storage keys. Author strings are attribution, not authenticated permission.

## Smallest useful integration

Keep the existing local directory transport. Extract byte encoding, decoding, and
validation from filesystem exchange so a Comb adapter uses the same Foundation format.
Define the required behavior before choosing final method names or wire APIs.

For the first remote slice, use one document feed with a service that accepts many
producers and owns publication to its Comb Log. Start with complete change blobs in
the feed, suitably encoded if the prototype requires text payloads. Deduplicate by
document ID and verified envelope hash. This avoids immediately inventing a separate
blob-index transaction. Compare per-peer refs only if the centralized publisher proves
an operational problem; that alternative adds discovery and checkpoint coordination.

The client saves locally before it uploads. Distinguish locally saved, pending upload,
and remotely committed states. A remote acknowledgement requires Comb publication,
not just uploading an object. Fresh clients replay a complete retained feed; do not
trim history until checkpoint, frontier, and recovery rules are implemented and tested.

Later, separate large assets and snapshots into referenced objects with explicit
retention roots. A `.chain` file remains a local snapshot and must not be synchronized
by whole-file overwrite. Never treat an unreferenced Comb object as a committed board.

Foundation requires a supported Comb client boundary. The current Rust implementation
puts higher-level Store and Log code in `combctl`; no TypeScript SDK or `combd` crate is
present in the inspected workspace. A narrow process or RPC bridge can support the
spike. Durable format code should remain in Comb, as its specification requires.

## Next moves, in order

1. **Fix peer-safe comment identity and verify the receive boundary.** Mint IDs from a
   unique replica identity and counter, or inject collision-resistant IDs at the caller.
   Separate authorship from replica identity. Add a regression through the actual CLI,
   MCP, or serve minting path, not just chain tests with preselected distinct IDs.
   Validate blob framing, envelope hash, document identity, and causal completeness
   before an import becomes visible. Inspect concurrent local snapshot writes too.

2. **Record the Foundation-on-Comb contract and correct the delivery baseline.** Update
   SPEC sync guidance and PRD ownership without changing the four document decisions.
   Record retry, deduplication, local-versus-remote acknowledgement, tenant scope,
   reconnect, and recovery behavior. Comb's production readiness gates include retry
   idempotency, reliable follow/replay, bounded storage growth, and protected retention.

3. **Ship the two-peer board demonstration.** Two peers fork a board, edit disjoint
   nodes and the same property, and add comments offline. Reconnect with duplicate
   delivery and an interrupted acknowledgement. Both must converge, preserve both
   comments, and report overlapping edits. Restart the sync service and recover on a
   fresh peer. The plain CLI must support the scenario with Apiary closed. Run the
   final acceptance on two machines, including a temporary backend outage.

4. **Complete the review loop in the existing Apiary pane.** Show durable sync status,
   preview an old anchor, compare structural and visual changes, and connect comment,
   agent patch, and resolution into one usable workflow. Verify these interactions
   manually in the actual app. The pane already exists and should be extended.

5. **Implement versioned Product design-system inheritance.** Specify precedence,
   explicit overrides, and conformance deltas. Pin dependency revisions so a remote
   system update cannot silently change an old board or frozen artifact. Then prove
   a design and its component can be reviewed together in a real PR.

Treat the standalone app and additional framework export targets as later product
decisions, after the shared-board workflow sees repeated use.

## Verification and limits

- `pnpm typecheck` passed.
- The default `pnpm test` run reported failures around test timeout thresholds across
  importer and render cases. Host load averages were `43.77 24.66 15.67`. The run was
  interrupted after repeated timeouts; there is no complete suite verdict, and load is
  a plausible contributor rather than a proven explanation for every failure.
- Focused chain verification passed: `pnpm exec vitest run
  packages/engine/test/chain-exchange.test.ts
  packages/engine/test/chain-annotations.test.ts
  packages/engine/test/chain-envelope.test.ts --maxWorkers=1`, 24 tests in 3 files.
  The existing concurrent annotation test supplies distinct IDs, so it does not
  exercise the production minter collision.
- A one-worker rerun of `packages/importer/test/harness-sandbox.test.ts` and
  `packages/engine/test/render-determinism.test.ts` passed all 7 tests. These include
  two of the earlier failing cases. This supports the load explanation for those
  cases, but does not establish a green full suite.
- Direct execution created two independent forks using the production
  `mintAnnotationId`, applied one comment on each, and merged in both directions.
  Output: `mintedIds=["a1","a1"]`, `expectedComments=2`, `actualComments=1`,
  `converged=true`. This is independent of the test-suite timeout issue.
- `gh pr list` and `gh run list -L 4` returned no entries. No `.github` directory is
  present in this Foundation checkout.
- Comb source was sampled against v0.3 and its existing August 25 analysis. Comb tests,
  backend drills, and hosted deployment were not rerun. Performance figures from the
  previous analysis were not used as fresh measurements.
- Apiary tools were absent from the available tool inventory, so live `self`, `setup`,
  UI verification, and authenticated child-agent exploration were unavailable. The
  assessment used local source inspection without a reviewer panel.
- No application code was changed. Pre-existing untracked nightly QA reports were
  left untouched.
