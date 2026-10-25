# Capture comparison

`pnpm exec tsx packages/proof/src/compare/cli.ts DESIGN_DIR CODE_DIR OUT_DIR`

Reads `dom.json`, `meta.json`, `screenshot.png` per plan.md v3. Writes `drift-report.json`, `diff.png`, and both source images. Compare reports default to 0.1% pixel ratio, 1px geometry/style, ΔE76 1, pixelmatch threshold 0.1 with AA excluded. `compareDirectories` accepts overrides and records them. Geometry is CSS pixels; image counts use device pixels.

Unique `fdnId` pairs match first. Remaining visual nodes are assigned globally with a Hungarian solver and dummy unmatched slots, using direct text, role/name, tag, IoU and path. Report `matches` lists confidence scores; these are not calibrated probabilities. Missing/extra nodes are drifts. Unpainted plain wrappers are excluded; painted nodes, text, controls and flex/grid layout nodes remain. Descendants must already have their own direct text and geometry in the capture.

Only the fixed properties in `style.ts` are compared. Numeric single-px properties use a px tolerance; colours use Lab ΔE76 with alpha distance. Composite values such as shadows are exact-string comparisons. Token lookup normalizes hex/rgb; equal aliases resolve alphabetically and do not prove which CSS variable code used. Heuristic matching can be wrong for repeated/reorganized nodes. Reports show correspondence so reviewers can audit it.

`measure.ts [INPUT_HTML] [OUTPUT_DIR]` bakes a real Foundation document and runs nine controlled browser mutations. The probes are isolated fixed boxes over the actual design: counts measure detection without cascades, not real component alignment. Primary measurement evidence is in `evidence/measurements.json` (repository board) and `evidence/authoritative/measurements.json` (authoritative input). Screenshot mutation controls remain separate from real Tracks comparison. No UI was added by this tool; the screenshots are capture/comparison evidence, not an application UI change.
