# Doctor prototype

Run from Foundation with dependencies installed:

```sh
pnpm exec tsx packages/proof/src/doctor/cli.ts /path/to/repo path/Component.tsx#Export [harness-url] [root-selector]
```

This is the proposed `foundation doctor` diagnostic engine, not a wired public CLI command. JSON is `fdn-doctor/0`. A missing runtime URL explicitly returns `not-provable`; source warnings never mean drift or a match. The CLI currently exits 0 for a completed diagnostic, 2 for invalid arguments. A future `foundation check` should gate on the full proof/report, not this advisory scan.

Source scan follows relative value imports and re-exports, reports ambient calls and external imports with source lines. It is lexical: comments/strings and effect/handler calls may be false positives; aliases, package exports, dynamic expressions and type imports need a bundler-resolved AST graph before CI enforcement. The output exposes unresolved coverage. Forbidden-import advice: move the dependency behind a container or inject a fixture adapter. Ambient-api advice: supply time/data/bridge from the harness, then runtime-probe it. Do not mechanically remove every flagged call.

Runtime loads the target twice in fresh Chromium contexts, blocks non-asset network, service workers, WebSocket/EventSource and intervals, records timeouts, catches page errors, freezes date/random, waits `window.__foundationReady`, fonts and two frames, and compares root DOM plus screenshot hashes. Default viewport 1280×800 at DPR 1 is prototype-only: invoke each actual viewport through the capture runner before a proof verdict. A same-origin asset GET can still have server side effects; use a dedicated static fixture server. WebSocket instrumentation currently rejects even Vite HMR: disable HMR for the proof target. The harness must replace bridge getters via `Object.defineProperty` in `prepare` before imports.

A successful probe only establishes this sampled state under these controls. It does not inspect arbitrary native IPC, close all browser I/O channels, guarantee later stability, run interaction steps, or certify screenshot identity against the design. Storage, observers, portal roots, crypto randomness, fonts and provider lifecycles still require explicit harness fixtures. A missing provider produces a captured error; an app that catches it into a fallback needs an expected-root/state assertion in its harness.
