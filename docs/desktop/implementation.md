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

## Final acceptance input diagnosis

The immutable host package contains host `4a030fb`, store `f932133` and shutdown `0f64398`. The first final driver attempt timed out waiting for renderer readiness; direct packaged-host probes recovered the exact seed successfully. The next attempt had an empty comment field after a native automated fill. The third recorded the exact comment value, enabled Post, `canEdit: true`, renderer `pending: 0`, `ready: true`, no failure and the attached input listener. That comment saved locally. The later failure selected the photo instead of the mobile headline, so its text editor was correctly hidden. All three failed reports remain preserved; the external host exited with code zero.

A separate two-window input trace selected the expected layers six times. It also recorded an extra canvas pointer event before the scripted clicks and OS-resized windows. This does not identify the source of that event. The coordinator approved DOM clicks and input events for the data acceptance run. They invoke the actual UI handlers, with explicit selection, visibility, editability, field-value, enabled-Post and local-save assertions. All mutations still traverse renderer, preload, HTTP service and Comb. The driver does not mutate through host endpoints directly. Physical pointer interaction remains covered by the prototype smoke test.

## Immutable package gate passed

2026-09-07: `final-proof-4a030fb-4/report.json` records `passed: true`, all data checks passed, external host exit code zero and no shutdown errors. Both independent same-author replicas saved distinct offline headline edits and anchored comments. Connect published them through the real immutable Comb binary; both documents and comments matched with zero pending and caught-up status. Disconnecting one client left the other connected. Both app processes restarted with the exact saved documents and original replica identities.

The packaged standalone app then saved offline, connected through bundled Comb using its generated private local configuration, reached zero pending/caught-up, closed, and reopened the exact saved edit. Every app and the external host shut down cleanly. The five screenshots and diagnostics remain beside the report under `packages/desktop/.runtime-downloads/final-proof-4a030fb-4/`.

The app at `packages/desktop/release/Foundation.app` remained unchanged throughout the final driver work. Its host entry SHA-256 is `e95665ef932c3e84b2220262aae8f8f3194c7af984812db1146faa3794032e89`; Comb is `a0489c7e4414a1c524c71d0a3ffc4c7b9d968483f8510ad1640c784784c072f1`. The report also retains the Node, main-process and renderer hashes. This follow-up changes only the acceptance driver and documentation.

The coordinator owns the identical installed copy at `/Users/trmd/Applications/Foundation.app`. Its bundled `Contents/Resources/open-two-clients.mjs` launcher uses the bundled Node and a fresh session directory to leave two editable windows open without automated edits. The coordinator will launch the manual handoff after this gate.
