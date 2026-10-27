# Tracks pane ground truth (R1)

Hand labels for the three provable Tracks states (track-selected, proposal-pending, empty), made by eye from
`../sample-captures/tracks-pane/<state>/1416x720@1/{design,code}` and the Classic TracksPane source
(apiary `proto/design-to-code-tracks` @ ccbf95d), without looking at matcher output. At-rest is not provable and has no labels.

## `<state>.correspondence.csv`

One row per visual design layer: a node with its own text, a background/border/shadow, an icon root (`svg`), or a
visible layout block (column, row, card, section). Pure wrappers, `display: contents` instance nodes, SVG internals
and the individual pixels of the empty-state bee are skipped.

| column | meaning |
|---|---|
| design_path / code_path | `path` in the matching `dom.json`; `code_path` is `none` when the code has nothing that renders the same thing |
| design_fdn_id | design node id from dom.json |
| design_desc / code_desc | short description (text content or role) |
| confidence | `sure` or `unsure`; `note` says why |

Several design layers may map to one code layer (for example, both queued rows map to the single "up next" line).

## `<state>.defects.csv`

One row per user-visible difference, filed the way a designer would: one cause per row, even when it moves many boxes.

| column | meaning |
|---|---|
| id | `S-nn` track-selected, `P-nn` proposal-pending, `E-nn` empty |
| design_layer / code_layer | dom.json paths; `;` separates several; `*` in a segment means "every sibling index" (for example every track row); a bare `*` means every text node; `none` = no layer on that side |
| kind | style, layout, missing, extra, text, token, environment (Linux font substitution, not a product defect) |
| severity | high, medium, low |
| likely_intentional | yes, no, unsure |
| note | starts with a stable slug in brackets (`[row-meta]`); the same slug in two states is the same cause |
| properties | `;`-separated computed properties the defect touches, or `subtree` for a whole missing/extra region, `text` for copy, `layout` for structure |

`tools/` holds the scripts that write these files from the hand-written rules (`label.py`, `defects.py`) and the
DOM dump used while labelling (`dump.py`). Run with `python3 -I tools/label.py <sample-captures/tracks-pane> <out>`.
