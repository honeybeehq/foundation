# Foundation desktop design study

Open `index.html` directly in a browser. It contains the styles, interaction code, photographs, and icons; no server or network connection is required.

To serve it from the repository root:

```sh
python3 -m http.server 4318 --bind 127.0.0.1 --directory spikes/desktop-prototype
```

Open http://127.0.0.1:4318. Use a desktop window around 1500 × 980 to see the intended composition.

Select layers on the canvas or in the layer list. Double-click text to edit it. Change geometry, typography, opacity, corner radius, and fill in the inspector. Open Tokens to change colors shared across both artboards. Assets selects example components already on the canvas.

Use the toolbar to add text and rectangles. Drag layers to move them. Arrow keys nudge by one pixel; Shift nudges by ten. Hold Space to pan, or choose the hand tool. Command-scroll zooms, and Shift 1 fits both artboards. Command-Z undoes; Shift-Command-Z redoes. The play button hides the editing panels.

Edits stay in memory. **Export study** downloads a self-contained HTML copy with the current edits. Reopen that file to continue the study.

This is one proposed desktop design, pending review. It is separate from the Foundation engine and does not produce valid `.fdn.html` documents. The component examples share color tokens, but full component definitions, overrides, JavaScript editing, AI work, comments, custom artboards, and interaction prototyping are reserved for later design passes. The narrow layout keeps the prototype usable in a browser sidecar; it is not yet a dedicated Foundation sidecar design.

Run the focused checks from the repository root:

```sh
node --test spikes/desktop-prototype/model.test.mjs
node spikes/desktop-prototype/smoke.mjs
pnpm typecheck
```

The smoke check uses the repository's Playwright dependency and Chromium. It checks selection, edits, undo and redo, shared tokens, insertion, dragging, zoom, preview, exported HTML, and compact layouts. It writes local PNG previews, which Git ignores.

Manually assess canvas navigation with a trackpad, editing comfort, panel density, and text contrast on the target display before settling on the design. Asset credits are in `THIRD_PARTY_NOTICES.md`.
