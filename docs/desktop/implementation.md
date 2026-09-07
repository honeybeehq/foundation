# Desktop host client

This Cell owns `packages/desktop` and the existing `spikes/desktop-prototype` study. The coordinating agent owns the host service, engine, Comb bridge, SQLite store and final integration. Baseline is `a270503`; implementation branch is `feat/desktop-host-client`.

The desktop preserves the accepted compact docked layout, one header, neutral gray chrome, light blue accent, appearance sliders and middle mouse panning.

## Plan and boundary

1. Ground: inspect the study model and engine `FdnDocument`/`PatchOp` contracts.
2. Sketch: compare importing the host in Electron main with calling a local service. Use the service so Node 24 SQLite and one Comb broker have one owner across independent desktop processes.
3. Agree: send the HTTP interface to the coordinator before implementing transport.
4. Implement: bundled Electron renderer, preload capability API, main-process loopback client, granular model adapter, comments and honest status.
5. Verify: typecheck, build, model/transport tests, desktop launch, then live two-client offline/reconnect proof with the host owner.
6. Commit explicit owned paths and hand off without merging or pushing.

The critical dependency is the host service contract; asset extraction, the model adapter and the shell build can proceed independently. Further worker checkouts would violate the user's explicit Cell restriction, so this agent implements its assigned slice locally. Host and SQLite work already run independently under the coordinator.

The renderer cannot access filesystem paths, host credentials or arbitrary IPC channels. Main opens its configured replica directory and forwards only document operations. Each app instance has a distinct directory, while all instances share the coordinator's host broker. Disconnect affects publishing; local authoring still requires the local host process. A transport failure is an unsaved/error state, never published success.

Images stay bundled in `assets/`. The seed stores board roots, child layers, styles, text, tokens and asset references. Gesture edits produce `set-style`, `set-text`, `set-token` and node operations. The renderer never sends `replace-document`.

## Verification record

2026-09-07: typecheck, build, ten desktop logic tests and the existing full prototype smoke passed. The standalone study's five model tests also passed. The generated seed is 2,849 JSON bytes and references two extracted image assets.

The actual two-client Electron run used the coordinator's development host bundle, official Node v24.20.0 and the accepted immutable Comb bridge. Both windows used `user:same-designer`, one document ID, independent SQLite directories and an isolated local object backend. Offline text edits and anchored comments were admitted in both replicas. Explicit connect converged both edited fields and both unique comments through real Comb. Both footers showed published/caught-up and zero pending changes. Disconnecting A left B connected. Both app processes restarted with the same documents, comments and replica identities.

Packaged standalone first launch and saved-edit reopen also passed. The last cleanup exposed an Electron lifecycle issue: `window-all-closed` is not guaranteed during `app.quit()`. Main now continues shutdown explicitly from `closed`, after the renderer accepts `beforeunload`. The acceptance driver bounds shutdown to 30 seconds. The final package gate must verify this fix and the coordinator's refreshed immutable host bundle.

Preserved development evidence is under `packages/desktop/.runtime-downloads/live-proof-3/`, including screenshots and `report.json`. Its data checks passed, but its overall result records the cleanup failure rather than treating the forced stop as a clean exit. The development app remains at `packages/desktop/release/Foundation-local.app`. These large local artifacts are ignored by Git.
