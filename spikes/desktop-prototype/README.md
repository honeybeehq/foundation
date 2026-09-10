# Foundation desktop design study

Open `index.html` directly in a browser. It contains the styles, interaction code, photographs, and icons; no server or network connection is required.

To serve it from the repository root:

```sh
python3 -m http.server 4318 --bind 127.0.0.1 --directory spikes/desktop-prototype
```

Open http://127.0.0.1:4318. Use a desktop window around 1500 × 980 to see the intended composition.

The editor chrome follows the Apiary design system (`packages/ui/src/tokens.stylex.ts` in the Apiary repository): warm charcoal neutrals, Hanken Grotesk for interface text, IBM Plex Mono for data, 4/6/8 px radii, panes separated by distance rather than borders, and a single honey accent reserved for the one primary action and the focus cue. Selection on the canvas uses Apiary's inspector blue; selected rows and active tabs use neutral fills, never the accent. The canvas artwork keeps its own document tokens.

Open **Appearance** in the footer (next to Shortcuts) to switch between **Charcoal** (default, Apiary's dark branch) and **Paper** (Apiary's light branch). In Charcoal, **Panel brightness** and **Canvas background** move along the same warm ramp; Deep, Charcoal, and Lifted are presets. Paper uses Apiary's fixed light tokens and parks the sliders.

The same menu switches **Docked** and **Floating** panels (floating corner radius 8–24 px, default 12) and the accent: Honey (default), Amber, Blue, Sage, Clay, and Lilac are all drawn from Apiary's own palette, each with a light and a dark value; a custom color is also accepted. **Apiary default** restores Charcoal, Docked, and Honey. Changes apply immediately and preserve document edits.

Appearance choices are recorded in the URL parameters `scheme`, `panels`, `accent`, `corners`, `shade`, and `canvas`, and are included in exported HTML. For example, `?scheme=light&panels=floating&accent=blue` opens the Paper scheme with floating panels and a blue accent.

The app has one header. Project navigation sits above the layers, Design/Prototype/Code controls sit above properties, and a floating zoom control sits at the canvas’s top-right corner.

Select layers on the canvas or in the layer list. Double-click text to edit it. Change geometry, typography, opacity, corner radius, and fill in the inspector. Open Tokens to change colors shared across both artboards. Assets selects example components already on the canvas.

Use the toolbar to add text and rectangles; each dock button shows its hotkey (V move, H pan, R rectangle, T text, F artboards, C comments). Click a frame row in the layer list to focus the camera on that artboard; the chevron alone expands or collapses it. Drag layers to move them. Arrow keys nudge by one pixel; Shift nudges by ten. Hold the middle mouse button and drag to pan anywhere on the canvas, including over artboards and editable text. This preserves the current selection and tool. You can also hold Space or choose the hand tool. Command-scroll zooms, and Shift 1 fits both artboards. Command-Z undoes; Shift-Command-Z redoes. The play button hides the editing panels.

Edits stay in memory. **Export study** downloads a self-contained HTML copy with the current edits. Reopen that file to continue the study.

This is a desktop design study in the Apiary look, with switchable scheme, panel, and accent treatments, pending review. It is separate from the Foundation engine and does not produce valid `.fdn.html` documents. The component examples share color tokens, but full component definitions, overrides, JavaScript editing, AI work, comments, custom artboards, and interaction prototyping are reserved for later design passes. The narrow layout keeps the prototype usable in a browser sidecar; it is not yet a dedicated Foundation sidecar design.

Run the focused checks from the repository root:

```sh
node --test spikes/desktop-prototype/model.test.mjs
node spikes/desktop-prototype/smoke.mjs
pnpm typecheck
```

The smoke check uses the repository's Playwright dependency and Chromium. It checks selection, edits, undo and redo, shared tokens, insertion, dragging, zoom, preview, exported HTML, compact layouts, appearance combinations, URL state, and exported appearance. It writes local PNG previews, which Git ignores.

Manually assess canvas navigation with a trackpad, editing comfort, panel density, and text contrast on the target display before settling on the design. Asset credits are in `THIRD_PARTY_NOTICES.md`.
