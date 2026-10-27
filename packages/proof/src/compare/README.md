# Capture comparison

`pnpm exec tsx packages/proof/src/compare/cli.ts DESIGN_DIR CODE_DIR OUT_DIR`

Reads `dom.json`, `meta.json`, `screenshot.png` per plan.md v3. Writes `drift-report.json`, `diff.png`, and both source images. Compare reports default to 0.1% pixel ratio, 1px geometry/style, ΔE76 1, pixelmatch threshold 0.1 with AA excluded. `compareDirectories` accepts overrides and records them. Geometry is CSS pixels; image counts use device pixels.

Unique `fdnId` pairs match first. Remaining visual nodes are assigned globally with a Hungarian solver and dummy unmatched slots, using direct text, role/name, tag, IoU and path. Report `matches` lists confidence scores; these are not calibrated probabilities. Missing/extra nodes are drifts. Unpainted plain wrappers are excluded; painted nodes, text, controls and flex/grid layout nodes remain. Descendants must already have their own direct text and geometry in the capture.

Both captures must provide the same 54-property list; incomplete captures are not-provable. Unpainted zero-width border colours/styles are ignored. Only the fixed properties in `style.ts` are compared. Numeric single-px properties use a px tolerance; colours use Lab ΔE76 with alpha distance. Composite values such as shadows are exact-string comparisons. Token lookup normalizes hex/rgb; equal aliases resolve alphabetically and do not prove which CSS variable code used. Heuristic matching can be wrong for repeated/reorganized nodes. Reports show correspondence so reviewers can audit it.

`measure.ts [INPUT_HTML] [OUTPUT_DIR]` bakes a real Foundation document and runs fourteen controlled browser mutations. Eleven controls use isolated fixed boxes over the actual design; three additionally change the original heading padding, colour and text. Counts measure controlled detection, not real component alignment or false-positive rates. Primary measurement evidence is in `evidence/measurements.json` (repository board) and `evidence/authoritative/measurements.json` (authoritative input). Screenshot mutation controls remain separate from real Tracks comparison. No UI was added by this tool; the screenshots are capture/comparison evidence, not an application UI change.

Output reports use canonical SHA256 hashes and bundle source DOM/meta/screenshots in `design-capture/` and `code-capture/` for verifier replay.

Pinned captures validate the actual CDP glyph inventory against hashed declared assets and matching browser/platform/source fingerprints. Source authoredFontFamily is compared for font-family drift while rendered normalized stacks are retained separately; alias normalization does not erase authored stack changes. The environment regression test covers invalid capture metadata and hidden family drift. Final dataset provenance and the historical fallback-font incident are in RESULTS.md.

Layout-only mode is opt-in: `cli.ts DESIGN CODE OUT --layout-only`, or
`compare(design, code, tolerances, {mode:'layout-only'})`. Captures must carry
`layoutOnlyRegions`, resolved from artboard/state `layoutOnly.regions` in
links.json. Each declaration pairs `id`, `designNode` and `codeSelector`; an
optional `repeat` contains `designSelector` and `codeSelector`. Excess repeated
items are ignored; loss of all items is a presence finding. Shared stable ids
preserve semantic order, with ordinal geometry for remaining common templates.

Only declared markers and common template boxes are checked. Descendant marked
regions use a declared parent as their coordinate frame to avoid repeating a
parent displacement. This mode does not establish full-panel equality: text,
styles, pixels, unmarked content and excess declared repetition do not set the
verdict. The report records coverage and ignored item counts. Missing/ambiguous
markers are not-provable. Pixel output remains diagnostic. Full mode is the
unchanged default.
