# Editing a design

Select a layer, edit its content or appearance, and reopen the app to see the saved design.

## Sub-features

- `editing.select`: correct selected layer and inspector fields.
- `editing.text`: exact text stored and rendered.
- `editing.geometry`: valid position/size edits persist; invalid values do not corrupt the document.
- `editing.insert`: new text/rectangle appears with a unique ID.
- `editing.undo-redo`: inverse and forward edits are saved.
- `editing.reopen`: saved document and replica identity survive a process restart.

## How to get to it (user POV)

Select through Layers, an Assets card, or a canvas object. Edit text in the inspector or double-click it on the canvas. Position/size controls and alignment buttons are in the inspector; arrow keys nudge the selection. The toolbar adds text/rectangles, with T/R shortcuts; Add layer adds a rectangle. Undo/redo are footer buttons or Meta+Z / Meta+Shift+Z.

## Driving it with control-foundation

Preconditions: fresh baseline, Design inspector visible; `C` is defined in the feature index.

- Layer-tree selection: `C click '#layer-tree [data-select="heading"]' --label editing-tree`. `C snapshot` must show selection `heading` and Hero headline in the inspector. Assets selection uses `C click '[data-tab="assets"]'`, then `C click '#assets-tab [data-select="cta"]'`; return with `C click '[data-tab="layers"]'`.
- Text: `C fill '#text-content' 'VERIFY Foundation headline' --label editing-inspector`; `C wait-state document.body.0.children.0.text '"VERIFY Foundation headline"'`. `C wait '[data-node="heading"]' 'VERIFY Foundation headline'` proves the canvas too.
- Undo/redo: `C click '#undo' --label editing-undo`, then `C wait-state document.body.0.children.0.text '"A slower kind\nof somewhere."'`; `C click '#redo' --label editing-redo` and assert the verification headline again. For shortcuts, first blur fields with `C press Escape`, then `C press Meta+z` / `C press Meta+Shift+z`; assert the same stored values.
- Geometry: `C fill 'input[data-prop="x"]' '120' --label editing-position`; `C state` must show the heading's left style `120px`; capture the moved canvas. `C click '[data-align="left"]'` should change it to `0px`. Use `C snapshot` to inspect width/height controls before editing.
- Insert: `C click '#insert-text' --label editing-insert-text` or `C click '#insert-rectangle' --label editing-insert-rectangle`; compare before/after `state` for exactly one new node and a unique ID, and the selected new layer in `snapshot`. Alternative rectangle entry is `#add-layer`.
- Persistence: after exact stored-state assertions, `C restart --label editing-reopen`; this asserts the complete saved document and replica ID are unchanged. Capture `C screenshot --label editing-reopened`.

## Gotchas

The seed heading is `document.body.0.children.0`; inspect by node ID before using indices in another document. Text changes save on input; numeric geometry changes save on change. `fill` handles both and blurs. Undo history is per running window and is reset by reopen. Default DOM clicks do not drive canvas `pointerdown` selection, double-click text editing, drag, or resize hit targets; those need pointer commands/OS input and must be reported separately. Do not call `foundationEditor.select/replace` or `foundationHost.commit` to prove these entry points.
