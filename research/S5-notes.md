# S5 — designs sync between machines and survive outages

All seven drill steps passed on Studio and metal-3 using CLI edits and the real JSONL session protocol. The final corrected conflict has two changes with the same causal parent. Both machines ended with identical design and chain bytes, 111 history changes, clean Git trees, and shared status with zero pending changes.

Peer visibility and durable storage are different measurements. With the optional authenticated peer path, measured visibility meets the target. After a cold whole-store restart, both replicas reported durable sharing within 19.164 seconds of the restart request; that includes store warmup. Its cause and a worst-case bound are not established.

## Build and isolation

The Studio Cell and fresh satellite Cell started at the requested Project head `f5902825a699b4f4cfe675aadde3adc4439fc64d`. The final installed source on both machines was `30bea85f5634b20d4e7bf552e40e4809eccac3a6`, dirty=false, attested by installed `--version` and session welcome. It includes Project `e2e1f6e`, S1c compatibility, S1d stable lock ownership, S3b materialization, S4b supported pull, and S3c direct delivery. Later S3c test/docs commits were not installed or needed for the measured runtime.

Only owned Cells were modified. No real `~/.local/bin/foundation`, gateway registry, Apiary Design code, or application bundle changed. Foundation was installed into a TEMP HOME on each machine:

```sh
HOME="$TEMP_HOME" node --import tsx packages/cli/src/main.ts install --from "$OWN_CELL" --sha "$CANDIDATE"
```

Comb was cloned freshly on each machine from `git@github.com:honeybeehq/comb.git`, checked at `b73e9bb3ff5e8850a77f36a95df40428fc722891`, and built natively with `cargo build -p combctl --bin comb-bridge`. Studio used Node24.20.0; metal-3 Node24.18.0/Linux6.12.94. Studio has native macOS `ioreg`/`sysctl` lock proof; it passed dead-owner recovery, live-owner refusal, and one winner among racing breakers.

The scratch design came from `boards/tracks-pane.fdn.html`, upgraded through the real CLI to artboards. Its legacy chain lacked a document identity, so a fresh chain was initialized and common genesis bytes shared. This drill does not prove replay of that old legacy history. Final workspace was `s5-final`, product `foundation`, document `6c291ec0-31b8-4f78-8eb2-78fdd8fbc4bb`. Each machine had its own scratch Git repo, replica store, explicit node id/name, and session author. `foundation git setup` ran in each scratch repo. Session authors and origin machine are recorded in saved history.

Skills used: astack-principles, diagnosing-bugs, show-me-your-work. Foundation has no repository verification skill (removed in `42594d8`); none was claimed. The decision trail is `.audit/S5/decisions.tsv`, exported with the proof.

## Storage and commands

A temporary SeaweedFS4.49 S3 store ran on metal-3 in user space with data inside the helper's owned Cell. Internal services bound loopback; a tailnet proxy exposed signed S3 at `100.76.147.56:19333`. Bucket `foundation-s5`, region `us-east-1`, prefix `s5-20261024`, tenant `foundation-s5`. Random one-use S3, digest, API, and peer keys were used. Private configuration was mode0600. Bridge configuration selected the native binary and `--dir` private Comb TOML; credentials entered its environment through AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_EC2_METADATA_DISABLED=true. No permanent storage location was chosen.

The shared S3 proxy returned 503 while the actual Seaweed process was stopped. Satellite-only denial used loopback proxy 19342, returning 503 only to that machine. Performance runs used an equivalent traced proxy 19344. These are backend-denial tests, not packet loss or a physical tailnet partition. The exact public invocation is retained as `satellite-seaweed-command.txt`; its arguments were:

```sh
weed mini -dir="$SAT_CELL/.audit/s5/storage" -ip=127.0.0.1 -ip.bind=127.0.0.1 -s3.port=19339 -master.port=19334 -master.port.grpc=29334 -volume.port=19335 -volume.port.grpc=29335 -filer.port=19336 -filer.port.grpc=29336 -admin.port=19337 -admin.port.grpc=29337 -admin.port.legacy=0 -admin.ui=false -s3.config="$SAT_CELL/.audit/s5/private/s3.json" -bucket=foundation-s5
```

Normal operations were:

```sh
foundation git setup
foundation sync open board.fdn.html --workspace s5-final --product foundation
foundation sync serve --comb-config /private/bridge.json
foundation session board.fdn.html
foundation edit board.fdn.html --ops '<real JSON operations>' --author '<writer>'
foundation sync status --json
foundation sync materialize DOC_ID --workspace s5-final --product foundation --repo-root EMPTY_ROOT --comb-config /private/bridge.json --json
foundation git pull TRANSFER_BUNDLE main
```

Git bundles moved scratch commits between the machines; no GitHub push was used as a handover. The optional peer configuration used explicit tailnet addresses on 19486, node ids, workspace allowlists and HMAC keys. It never marked an edit shared before Comb acknowledged it. The fresh third replica used a configuration with no peer path.

## Final drill and evidence

Primary evidence is the rendered recording of the actual terminal output on both machines, with literal `script` PTY captures retained separately. The Studio movie renders the driver's timestamped output cast; the satellite movie renders exact PTY bytes with `script` timing. Playback shortens idle gaps and is labelled accordingly. It is terminal evidence, not a desktop recording. Build/preparation and bridge probes have separate logs. The main final chapter and later corrective concurrency chapter are retained; separate performance/control lanes are kept as supplemental raw evidence.

| Step | What actually passed | Evidence under `.audit/S5/` |
|---|---|---|
|1 Live | CLI/session edits and an annotation from each side arrive in the other session; authored history retains origin | final-semantics-output.log |
|2 Conflict | Both daemons/listeners stopped; parallel CLI batches share parent 5cbb51d…; same-property winner converges, both disjoint edits survive; exact HTML and chain bytes match | causal-concurrency-proof.json; causal-concurrency-merged.json; final-causal-branches-output.log |
|3 Undo | In each direction, session Undo reverts only that writer's change; the other writer's later disjoint edit remains | final-semantics-output.log |
|4 Satellite offline | Local saves continue with its daemon stopped, then merge; strict repeat disables peers and routes the live satellite daemon through 19342, while Studio remains healthy; both merge and become shared | final-outages-output.log; strict gate chapter in final-combined.log |
|5 Store outage | Actual store stopped, edits save on both sides, status shows waiting-to-upload; peer visibility can continue while pending; restart drains to identical bytes and shared | final-clean-durability-output.log; clean-durable-recovery.json |
|6 Restart/recovery | Daemon restarted during outage; a genuinely empty metal-3 third root materializes from Comb in 1424 ms; own replica store and durable-only daemon exchange a new change both directions | final-materialize-retry-output.log; final-third-resume-output.log |
|7 Git | Supported pull passes both directions after live sync; clean trees and stable mtimes 3 s. Diverged branch merge regenerates design and retains both values in committed bytes before daemons restart | final-git-output.log; final-causal-merge-seal-output.log |

The first final conflict attempt was causally sequential, despite parallel requests. It was not counted as simultaneous conflict acceptance. The corrective chapter proves both branches have exactly the same prevHash, with distinct bytes before reconnect. Final branch authors are S5-final-causal-Studio and S5-final-causal-metal3. The final seal supersedes the earlier 109-change snapshot.

## Timings

Visibility uses source chain mtime to the other machine's actual session event, unique marker/hash matching, and retained before/after clock RTT brackets. Conservative bounds use the union of observed offset intervals plus 2 ms timestamp guard; they assume no unobserved arbitrary clock step. Same-build ON/OFF each began at exactly 61 changes, one live copy per node, tracing off, three retained warmups followed by 20 steady samples per direction. All 80 measured saves arrived. History grew61→107 in each lane.

| Measurement | Studio→metal-3 | metal-3→Studio |
|---|---:|---:|
| Peer ON p50 upper |434ms|568ms|
| Peer ON p95 upper |593ms|918ms|
| Same-build peer OFF p50 upper |1619ms|913ms|
| Same-build peer OFF p95 upper |1756ms|1076ms|

These are rounded millisecond figures; `.audit/S5/visibility-recomputed.json` independently reproduces the raw-row calculations locally. ON and OFF were sequential, not interleaved: 09:13 and10:15 UTC. Both began from identical reconstructed 61-change bytes, not different histories. Studio pre-series load averages were 6.18/7.74/13.39 ON and 8.84/8.71/10.62 OFF. Earlier baseline load was higher (21–39 in some snapshots), so that earlier comparison is not the final control. This remains an observational two-host test. Steps 1–3 and 7 used peers enabled; durable-only propagation is established separately by strict satellite denial and the fresh third.

The corrected traced five-per-direction sample was 10/10 direct-first. Source notice medians 56/58 ms, strict direct import135/73ms, import→session155/200ms. These are stage observations, not independent steady-state populations. Full verification is included in strict import.

Matched local save measurements (three per condition, startup included for CLI):

| Local operation | Healthy ms | Store down ms |
|---|---|---|
| Studio CLI |668,396,358|578,360,349|
| metal-3 CLI |1839,1766,1853|1785,1743,1833|
| Studio long-lived session |63,43,43|83,44,44|
| metal-3 session receive→actual result stdout |141,149,164|169,176,168|

No consistent network-sized CLI outage penalty appeared. These small samples do not establish identical distributions. Metal-3 session times use its own clock and reassembled stdout, excluding API roundtrip/history observation. Clean durability replay had two pending changes per machine and both shared within 19.164 s from store-start request. An earlier 12-pending/~22s run may have been affected by synchronous observer calls blocking the test proxy; that mechanism was proven later, but its share of that earlier delay was not measured. The populations differ. Neither is a proven lease/backoff bound, and the 5 s retry cap does not establish a 5 s recovery bound.

## Fixes, failed attempts, and limits

S5-own source commits are `2a08e659fa1e1091fdd71cd0b88e39af4e66aeb7` (bounded read pages instead of follow1000) and `734db519252b79f5bd6ce61271df53363321bad9` (retry cap 5 s, half-to-full jitter). Original interim hashes 119e76/7a9e360 are superseded. The read change keeps cursor/framing/hash/causal checks; empty valid pages pause 250 ms. Native follow probes passed normally, but injected 60 ms/read produced 6/20 deadline errors, matching an internal wait-deadline race. No Comb core semantics changed. S3 author reviewed the original read-poll diff; this is not an independent review of the whole final peer implementation. On exact 30bea85, `sync-direct.test.ts` and `sync-direct-scheduling.test.ts` passed 4 tests in 2 files; typecheck passed and was rerun after sealing. After sealing, an additional exact 30bea85 focused integration run passed 34 tests in 8 files: sync-materialize, git-update, document-lock, sync-direct, sync-direct-scheduling, chain-format, sync-store and sync-bridge. The output is `final-focused-tests.log`. No full CLI/engine suite ran on30bea85. Test invocations used maxWorkers=1 and excluded `.audit` installed source copies.

Reported before fixes/workarounds: ordinary dirty pull refusal (S4b), missing true-empty materialize (S3b), macOS realpath test alias (S3b), hostname-sensitive dead daemon lock (S1d; an exact proven-dead legacy lock was moved aside before the fix, not counted as passing restart), visibility above target (S3c). A low-level direct path scheduling issue and causal-prefix publication issue were fixed by S3c before the final recorded run. The optional path is explicit-peer configuration, not discovery. Restart can reannounce a previously received change once; durability drain attribution remains open. Peer code source-review provenance: claude-opus-5-5 session fb9c3750 reviewed the initial b899efa→f50b5ee diff for direct.ts/daemon.ts/blob.ts. Later safety, independent-dispatch and causal-prefix changes were reviewed from author summaries, not a complete final-source diff. The S5 runtime check is firsthand and separate from source approval; ON numbers do not imply human acceptance of the feature.

Harness failures are retained rather than counted as product failures: wrong initial Git cwd/PATH (generated root setup artifacts removed); lost AWS env on one interim Studio restart; duplicate test discovery from TEMP installs; first annotation observer race; premature equal-old-main observer during third-replica proof; ineffective gate while B used 19344 (correct strict repeat used 19342). Fresh materialize initially timed out 35 s because a synchronous CLI child blocked the same process serving the S3 proxy. Standalone cold heads 25–29 ms and equal AWS env isolated that self-deadlock. Async child execution fixed the harness; no product timeout was widened, no third-replica seed was copied.

The install harness used `--force` when replacing an already-installed candidate; an earlier `--sha HEAD` attempt correctly failed until the full SHA was supplied. Driver loopback 19486 and peer tailnet 19486 were separate listeners; control/profile driver used 19487. Discarded provisional direct measurements and the corrected chain-byte metadata remain in the raw trail. The 61-change matched fixture was reconstructed from retained authentic update bytes and checked against its original saved hashes. Some TSV rows were reconstructed in batches at the end; their timestamps mark documentation, not the original event.

## Final seal

Both saved files were downloaded and compared byte-for-byte, not just by hash. History count 111; both scratch Git statuses empty; stable mtimes over 3 s. Metal-3 live status at reseal was shared/pending 0/cursor 112. Studio live status was not separately logged at that final moment; its retained persisted state updated 10:26:47 shows cursor 112, 111 published changes, pending 0 and null connection/receive/publish/catalogue errors (`studio-final-persisted-sync-state.json`).

- HTML SHA256: `9699059c93e2618e6f36c8ab725a51f5134ef111c22eb005660bc6a29492c2c3`
- Chain SHA256: `570876f50518c8a8000f38d7e052b2e39cf5d555c9bd5ae896fb70e72e4b2b52`
- Scratch Git HEAD: `118995dfcfa922d08e604b33618c7b323c06a9ba`

`final-hashes.json` includes both runtime attestations. `final-combined.log` includes timings and both-state observations. The final snapshots and temporary outputs remain uncommitted evidence.

## Teardown and review

Both individual terminal recordings, selected/full timestamped casts, satellite literal PTY archive, combined transcript, timings and corrected byte snapshots have been collected. The synchronized side-by-side movie is the first proof item. Source exports and decompressed archive entries passed a 39-entry scan for all five disposable credentials. Studio task daemons/sessions/API listeners are closed; every retained lock owner is dead, and ports 19485/19486/19487 plus the tailnet 19486 are unreachable. Studio TEMP HOME and all private bridge/backups/Comb config were removed from the active checkout using macOS trash. Satellite receipt 10:52:09 UTC confirms all 16 checked internal/tailnet ports have no listeners, no owned task processes remain, TEMP HOME/storage/private backups and temporary toolchains are absent, and 82 evidence files contain zero literal key matches. It preserved the corrected seal and clean scratch Git state. The helper removed its scoped temporary directories directly; Studio used trash. External Studio probes independently confirm all six exposed task endpoints are unreachable. `teardown-receipts.json` combines both-node receipts; real installs and registries remain untouched. Disposable credentials, including the peer HMAC key, appeared in private task mail, tool input and tool stdout in permanent agent transcripts; they are excluded from curated proof exports, not erased from those transcripts. All keys must be discarded and all task endpoints closed on both machines; they must never be reused. No permanent shared-store choice is implied.

Cross-family trail review: claude-opus-5-5 session b2b1336c read the notes, decision trail and root transcript. It did not rerun the drill. Its remaining flags are addressed or retained explicitly: optional-path latency dependency, source-review scope, non-interleaved load-sensitive timing, focused-only final tests, transcript-visible keys, unknown durability bound, Studio cast versus PTY provenance, and reconstructed trail timestamps. Movie QA and both-node teardown are now complete. The review is advisory; no independent final runtime rerun or complete source approval is implied.

After the trail review, a fresh exact 30bea85 source review found a Medium startup lifecycle issue: an initial updateDocument/readSyncState exception can leave a dead worker retained by the supervisor and stale shared status. S3c author 55899888 is fixing retry/backoff and visible errors in a separate commit/regression. That later startup fix is not part of this measured runtime; the all-seven results and timings remain scoped to30bea85. No final-source clean bill is claimed here.
