# Foundation-renderable component contract

A proof covers one linked implementation × named state × viewport in a pinned browser. It proves that captured case against the design, not the whole app. The implementation must be renderable in isolation; production containers may still fetch and subscribe.

## Rules shown to users

1. **Link the real view export, with its state and viewport, in `.foundation/links.json`.**
   Why: a screenshot of a replica says nothing about your app. Check: resolve `module#Export`, fixture and design node; reject missing or ambiguous entries.
2. **Keep data fetching, subscriptions and native calls outside the view’s render path.**
   Why: rendering must depend on supplied state. Check: scan its import closure, then probe the mounted tree for unexpected calls.
3. **Supply all required providers and fresh state through `foundation.harness.tsx`.**
   Why: hidden app context makes isolated results unreliable. Check: mount each fixture in a fresh context; fail provider errors and leaked state.
4. **Use named fixtures for every state; permit no live data or native I/O during capture.**
   Why: a proof must replay without your login or running backend. Check: default-deny requests and bridges; allow only declared fixture responses and local assets.
5. **Fix time, randomness, locale, viewport, fonts and motion.**
   Why: environmental changes can look like design drift. Check: record these inputs, await fonts/assets, freeze motion and repeat the capture.
6. **Make effects finite, fixture-backed and disposable.**
   Why: timers, observers and subscriptions can change the frame or leak into another state. Check: instrument them, wait explicit readiness, run cleanup and remount.
7. **Render all visible content inside the declared capture boundary, including portals.**
   Why: uncaptured menus and dialogs create false matches. Check: assert expected roots and portal hosts; compare their boxes and pixels.
8. **Resolve isolation failures through providers, an adapter, or a view split; otherwise declare “not provable.”**
   Why: missing evidence must never appear as “Matches.” Check: doctor diagnostics and `verdict: not-provable` with a reason block the proof gate.

## What gets linked

The authoritative prototype mapping is the separate `fdn-links/0` sidecar; it does not change `.fdn.html`. T2 owns its schema and reader. A mapping contains `designFile`, `viteConfig`, `harness`, and `artboards[]`. Each artboard declares `id`, `component: 'path#Export'`, `designNode`, `viewport: {width,height,dpr}`, and `states: [{name,fixture:'path#Export',designState,designNode?}]`. Optional component correspondences contain `{designComponent,code:'path#Export',selector}`. Resolve paths relative to the code repository using the link reader’s documented path rules; never infer the linked export from a filename alone.

`data-fdn-id` is optional correspondence metadata on real DOM nodes. It helps match design layers to code nodes; it does not select the module or make code isolated. Duplicate ids are errors for identity matching. An optional `/** @foundation view */` annotation advertises intended boundary/lint policy; it is not required and grants no exemption from probing. Link adapters and story exports explicitly and retain the underlying production component reference in proof provenance.

Prefer `TracksView({tracks, selection, onSelect})` beneath a production `TracksContainer` that owns servers and subscriptions. Rendering may compute values, read props/context, and create local framework state from fixture inputs. It must not perform I/O, mutate external stores, read moving wall time, generate random ids or alter globals. Deterministic framework ids are fine if stable across captures. Event handlers may call real services in production; proof interactions inject recording/no-op actions or finite fixture implementations. Never replace the production JSX/CSS with hand-copied proof markup.

## Harness and fixtures

Agreed with T2: `foundation.harness.tsx` exports optional `prepare()` and `mount({Component,fixture,root,state})`, returning a cleanup function, possibly asynchronously. The runner imports the harness first, awaits prepare, then dynamically imports the fixture and linked component. Harness top-level imports must themselves be safe; do not eagerly import a production bridge through a convenience barrel. The runner loads the target app's Vite config so aliases, StyleX transforms and CSS match production. A bundler adapter is infrastructure, not permission to bypass the linked implementation.

```tsx
// Illustrative repo-owned harness; these provider names are app-specific.
export async function prepare() {
  installFixtureBridge(); // before ANY production module can read the preload bridge
}
export async function mount({ Component, fixture, root, state }) {
  const store = createStore(fixture.store); // fresh, no singleton carry-over
  const app = createRoot(root);
  app.render(<ThemeProvider value={fixture.theme}>
    <MemoryRouter initialEntries={[fixture.route]}>
      <StoreProvider store={store}><Component {...fixture.props} /></StoreProvider>
    </MemoryRouter>
  </ThemeProvider>);
  await fixture.waitUntilReady?.({ root, state });
  return () => { app.unmount(); store.dispose?.(); resetFixtureBridge(); };
}
```

This guide's sample is not an additional required TypeScript API. Fixture exports may be objects with `props`, store snapshots, route, locale, theme, bridge responses and expected root/state assertions; callbacks stay in code modules, not JSON. Providers must use the real app's shape: context values, a fresh Redux store, a Zustand store factory/reset, or fresh signals. Seed query caches rather than fetching. Use a memory router with fixed location/history, bundled i18n messages with locale/timezone, and the actual theme/tokens/CSS. Include loading, empty, error and populated states only where linked to a design state; a default fixture does not cover them all. Await framework commit and fixture completion before readiness. Keep cleanup ownership explicit; always call it in a finally path, then dispose the browser context.

After mount and fixture readiness the runner awaits `document.fonts.ready` and two animation frames, then sets `window.__foundationReady = true`. Fonts-ready alone does not ensure the intended font exists: assert font family/face availability and record bundled file hashes; fail failed font/image loads and wait image decode. The capture records viewport/DPR, browser build, OS/font environment, locale/timezone, color scheme, theme, clock/seed, code commit, design head and fixture/harness/asset hashes. Two frames are a paint barrier, not a substitute for waiting on data.

## No live I/O

Serve static code/assets from the fixture server. Default-deny application requests, including localhost and same-origin API endpoints. MSW (unhandled request = error) or Playwright routes return named finite responses, including error and latency cases; record matched/unmatched requests. Configure interception before loading the app. Block service workers that would bypass routing; intercept/reject WebSocket/EventSource separately. A read-only API is still live I/O and can change a proof. Do not depend on a developer’s authentication cookies or desktop backend. No proof render should start a real server action, payment, file write or IPC request.

Fix the date and timezone, seeded randomness (including UUID/crypto through an injected id service), locale and all generated timestamps. Drive timers to a chosen logical instant using the runner’s clock; report pending recurring work and fail unbounded readiness. Disable CSS transitions/animations and freeze Web Animations at a declared frame. Freeze animated media too, or declare the region/state unsupported; do not silently mask it. Use the same controls for design and implementation. Playwright provides clock controls, but the prototype doctor currently fixes Date/Math.random, records real timeouts and blocks intervals: that narrower scope is reported rather than called full clock virtualization. [Playwright clock](https://playwright.dev/docs/clock).

## Effects and browser/native boundaries

Effects may measure layout, attach fixture observers/listeners, and update local UI to a finite ready state. Every listener, timer and subscription needs cleanup. They may not reach real storage, network or native services during proof. In proof mode, supply in-memory storage with declared initial keys, deterministic responses for IPC and disposable event emitters. Do not use blanket proxies returning `undefined`: missing methods must fail with an actionable name. `window.apiary` and `window.electron` fixtures must implement only the required bridge surface; unexpected calls fail and are logged. Install them in prepare before import-time store initialization; an Electron main process is not part of a browser proof.

Preserve real ResizeObserver behavior where possible. For tests needing geometry, use fixed viewport and actual browser layout, wait for observer delivery and assert no resize loop. IntersectionObserver needs deterministic scroll/visibility and finite delivery; if faked, declare exact entries and record that substitution. A no-op observer can hide the whole UI, so readiness must assert expected content. Virtual lists need fixture scroll position and bounds. Tooltips, dialogs and menus need a portal host within the capture root, or a declared broader boundary that captures every host. Reset portals on cleanup; do not hide overflow simply to remove a drift. Browser errors and swallowed provider fallback states require expected-state assertions.

## Escalation ladder

Use the cheapest rung that renders the **real** component faithfully:

1. **Wrap providers and seed dependencies.** Keep the existing linked export; supply context, stores, bridge, router, assets and finite responses.
2. **Add an adapter or story-style entry.** Adapt app-only props/services into fixture inputs, import the production component, and reuse its markup/styles. If a whole store import initializes a desktop backend, replace that dependency at an explicit seam and record it. Accept Storybook CSF as an optional future entry adapter: compose args, global/component/story decorators, loaders and parameters with the framework's portable-story API, then await documented play steps if that state needs them. A raw CSF object is not a React component. Unsupported addons/loaders fail clearly. Ladle/Histoire formats need their own adapters; do not assume identical metadata. The current T2 link schema supports `module#Export`; use a wrapper export today, not an invented `story` field. [Storybook portable stories](https://storybook.js.org/docs/api/portable-stories/portable-stories-jest), [survey](survey.md).
3. **Refactor a pure view from the container.** Move data/native effects into the container and pass state/actions to the view. Link the view, keep it on the real production path, and measure the source changes. Prefer this for repeated proofs when mocking a giant dependency graph becomes fragile.
4. **Declare not provable with a reason.** Examples: proprietary native renderer, missing server fixture, unresolved provider, readiness timeout, uncontrolled animation or nondeterministic output. Record which state/boundary failed and the next feasible rung. Do not use an imitation component as a substitute.

The report contract already has `provable: false`, `verdict: 'not-provable'`. T4 requires a nonempty top-level `reason` string for this verdict; never manufacture zero-valued pixel/layout results as if measured. Drift UI must show a neutral “Not provable” badge, reason and retry/fix action, no green “Matches,” no numeric “0 drifts” and no accept-design action derived from a missing capture. CI must fail or explicitly mark this case incomplete; it cannot count as passing coverage. A successful doctor probe is renderability evidence, not a comparison verdict.

## Framework adapters

React/Vite is implemented first; the following are adapter requirements, not claims of shipped support. All adapters preserve app transforms/CSS, isolate state, expose mount+cleanup and the same ready/capture contract.

| Framework | View boundary | Mount and cleanup |
|---|---|---|
| React | props + deterministic context/hooks; containers own services | `createRoot`, real providers; unmount; optional StrictMode probe catches effect cleanup bugs |
| Vue | SFC props/slots + injected fixture services, no live composable I/O | target Vue Vite plugin; `createApp`, app.provide/plugins, nextTick; app.unmount |
| Svelte | component props + fixture context/stores, isolated subscriptions | target compiler/plugin and version-specific mount API; tick; unmount/destroy and reset stores |
| Solid | props + fixture context/signals; resource values supplied | Solid plugin, render into root; flush reactive updates and call returned disposer |
| Web components | properties/attributes + injected services; safe custom-element registration | load real element definition, set props before append, await updateComplete or adapter readiness; remove and clean subscriptions; inspect shadow roots and capture their pixels |
| Next.js | client view receives resolved serializable server data | mount client boundary with fixed router/navigation/image/font adapters; keep server-only imports outside the browser graph |
| Remix / server loaders | route view consumes fixture loader/action data | stub route/router context with deterministic loader results; no real loader/action execution |

A Next server component cannot simply be imported into a generic browser gallery: it belongs to a separate server module graph. Either link its client/presentational view with fixture data or implement an explicitly offline SSR adapter that supplies server dependencies, renders HTML/RSC under the actual framework and hydrates under the same fixtures. Record whether the proof covers the extracted client view or the full SSR result; they are different claims. Streaming/Suspense must reach a declared settled state or have a separately linked loading state. [Next server/client boundary](https://nextjs.org/docs/app/getting-started/server-and-client-components).

## Doctor and check tooling

Prototype source: `packages/proof/src/doctor/`; invocation and limitations: [README](../packages/proof/src/doctor/README.md). Proposed public commands: `foundation doctor` explains isolation failures, `foundation check` gates complete proof results. Neither command is wired into the top-level CLI by T7; this is a runnable prototype under the owning subfolder.

The source scanner follows relative imports/re-exports, flags fetch/IPC/websocket/native modules, moving time/randomness, storage and timers, and reports external/unresolved edges. Production tooling should use the target bundler’s resolved import graph plus AST phase analysis to distinguish render calls, module initialization, effects and handlers. A `Date.now` in a click handler is a warning, not proof of impure render. A forbidden module that the target bundler replaces with a fixture is a documented seam, not automatically an error. The prototype is lexical, does not resolve package aliases and can flag comments/strings. It cannot certify a clean closure.

The Chromium probe installs controls before imports, loads the harness URL in two fresh contexts, reports blocked network/native calls, page/provider errors, interval attempts and timeout registrations, waits readiness/fonts, and hashes the capture root DOM and screenshot. Different hashes fail repeatability. Same hashes establish two sampled runs only. Fixed time/randomness explains away intended environmental variation; crypto ids, storage and observer policies remain explicit harness responsibilities. Full check must inspect all requested states/viewports, assert the expected state, and bind all controls and diagnostics into the proof. Do not gate CI solely on absence of lexical warnings or doctor process exit code.

Diagnostics should name the operation, source/import path where available, failing fixture/state, and smallest suggested next rung: “bridge tracks.list was not mocked; add a prepare fixture,” “AppContext missing; wrap AppProvider,” or “two captures differ; inject timestamp/id inputs.” Unavailable Chromium, missing fonts or a missing harness is `not-provable`, not drift.

## Applied to the Tracks pane

Primary case is Classic `apps/desktop/src/renderer/src/panes/TracksPane.tsx#TracksPane`; Next currently has ActionsPanel rather than the named Tracks pane. Do not describe this as proof of Next Tracks. Read-only scratch source cloned from `honeybeehq/apiary`, commit `f017553ad6f2b25b0d03215426a946a731e2db9a`.

Real pre-adaptation command:

```sh
pnpm exec tsx packages/proof/src/doctor/cli.ts /tmp/foundation-t7-apiary-readonly apps/desktop/src/renderer/src/panes/TracksPane.tsx#TracksPane
```

Actual output: [tracks-doctor-before.json](tracks-doctor-before.json). It visited **171 files**, reported **106 advisory findings**, and exposed **36 external/unresolved imports**. TracksPane itself contains eight bridge references (lines 345, 428–429, 441, 570–571, 609–610) and two timer call sites (151, 265). The closure includes app stores/sidecars: wrapping only a props object does not isolate it. These are lexical findings across the entire closure, including handlers; they are not 106 proven render failures. No pre-adaptation harness URL was supplied, so its runtime result is honestly **not-provable**, not a failed screenshot comparison.

T2's actual adaptation measurements and runtime doctor result will be appended after its harness is available. No rung or lines-changed count is claimed from the source scan alone.
