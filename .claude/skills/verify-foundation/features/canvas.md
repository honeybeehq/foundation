# Canvas navigation and appearance

Find a layer, inspect desktop/mobile artboards, adjust shared colors, and change workspace appearance.

## Sub-features

- `canvas.search`: matching/empty/cleared layer search.
- `canvas.zoom`: fit, zoom in/out and artboard focus.
- `canvas.preview`: preview hides editing chrome and Design restores it.
- `canvas.tokens`: shared token edits update stored values and their visible uses.
- `canvas.appearance`: workspace theme controls visibly change the chrome.

## How to get to it (user POV)

Search from the Layers search button. Zoom from the canvas controls or Shift+1; click an artboard row to focus it. Use Preview in the header and Design/Escape to return. Tokens can be reached through the Tokens tab, the inspector's View tokens button, or the Design system page. Workspace appearance opens from its header button. Pan uses the Hand tool, middle drag, Space+drag, or scroll; modified scroll zooms.

## Driving it with control-foundation

Preconditions: fresh baseline; use `snapshot` to compare visible controls and world/canvas screenshots. `C` comes from the index.

- Search: `C click '#search-toggle' --label canvas-search-open`; `C fill '#layer-search' 'Hero' --label canvas-search-match`; `C snapshot` must show Hero headline and hide unrelated layer rows. Search `NO-MATCH-VERIFY`, then clear with `C fill '#layer-search' ''`; empty and restored results must be observed.
- Zoom: `C click '#zoom-in' --label canvas-zoom-in`, then `C click '#zoom-out' --label canvas-zoom-out`; the `#zoom-fit` percentage and canvas scale must change. `C click '#zoom-fit' --label canvas-fit` fits both artboards. `C click '#layer-tree [data-collapse="mobile"]' --label canvas-focus-mobile` focuses the mobile board.
- Preview: `C click '#preview' --label canvas-preview`; compare screenshot and `aria-pressed`/visible chrome. `C click '#design-mode'` when visible, or `C press Escape --label canvas-preview-exit`, returns to editing.
- Tokens: `C click '[data-tab="tokens"]' --label canvas-tokens-tab` or `C click '#view-tokens' --label canvas-tokens-inspector`. `C fill 'input[data-token="forest"]' '#234567' --label canvas-token-edit`; `C state` must show token `forest` as `#234567` and the canvas must show its changed uses. Alternative entry: `C click '[data-page="system"]'`.
- Responsive viewport: `C viewport 480 844 --label canvas-mobile-viewport` emulates narrow content; `C click '#toggle-layers'` and `C click '#toggle-inspector'` expose the mobile side panels. Capture each view, then restore `C viewport 1440 900`. This tests responsive content, not native window constraints.
- Appearance: `C click '#appearance-toggle' --label canvas-appearance`; `C snapshot` exposes scheme/layout/accent controls. `C click '#original-appearance' --label canvas-appearance-default`; screenshot the visible result. Close using `C click '#appearance-close'` or `C press Escape`.

## Gotchas

DOM click is sufficient for buttons; it cannot prove middle-button panning, drag, wheel, or canvas hit targeting. Those require pointer/OS driving and action-plus-result evidence. Workspace appearance/zoom are not document edits; do not interpret their absence from host state as failed persistence. Color inputs use DOM fill to avoid opening a native color picker; native picker behavior remains a separate entry point. Search leaves artboard frame rows visible even with no matching layers.
