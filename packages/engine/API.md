# foundation-engine — module contract (L1 wave 1)

Owned by the integrator. Module boundaries and public signatures below are fixed;
implementations live one module per directory. A signature that can't be implemented
as written is a **finding to report**, not a contract to edit. All modules build
against `src/types.ts` only — no cross-module imports in wave 1 except as listed.

## Modules and owners

| Module | Directory | Wave | Implements |
|---|---|---|---|
| Grammar | `src/grammar/` | 1 | element/attribute schema, exclusion list, style-property rules |
| Parse | `src/parse/` | 1 | `.fdn.html` text → `FdnDocument` + `NormalizationReport` |
| Validate | `src/validate/` | 1 | `FdnDocument` → `ValidationResult` |
| Project | `src/project/` | 1 | `FdnDocument` → canonical text (deterministic) |
| Chain | `src/chain/` | 1 | Loro store + envelope + anchors + semantic diff |
| Bake | `src/bake/` | 1 | template + state → `BakeResult` |
| Render | `src/render/` | 2 | pinned-Chromium render + layout report |
| Diff | `src/diff/` | 2 | structural + visual + conformance diff |
| Serve | `src/serve/` | 2 | live-reload server with bake |
| Index | `src/index.ts` | 2 | public API wiring (integrator writes) |

## Fixed signatures

```ts
// parse
parseDocument(html: string): { doc: FdnDocument; report: NormalizationReport }

// validate
validateDocument(doc: FdnDocument): ValidationResult

// project — MUST be a fixpoint with parse: parse(project(doc)) deep-equals doc.
projectDocument(doc: FdnDocument): string

// bake
bakeDocument(doc: FdnDocument, opts?: { state?: string }): BakeResult

// chain
createChain(doc: FdnDocument, meta: ChangeMeta, opts?: { actor?: string }): FdnChain
loadChain(bytes: Uint8Array, opts?: { actor?: string }): FdnChain
// (actor on load added 2026-07-31: hash-of-bytes peer derivation collides when two
//  independent loads of the same snapshot both edit locally before merging)
interface FdnChain {
  doc(): FdnDocument
  versionRef(): string
  docAt(ref: string): FdnDocument
  historyRoot(): string | null
  apply(meta: ChangeMeta, ops: PatchOp[]): EnvelopeRecord   // one call = one change
  anchor(name: string): AnchorRef
  checkout(ref: AnchorRef): FdnDocument                      // non-destructive read
  diff(a: AnchorRef, b: AnchorRef): SemanticOp[]
  undo(meta: ChangeMeta): EnvelopeRecord                     // inverse-append
  head(): EnvelopeRecord
  log(): EnvelopeRecord[]
  fork(actor: string): FdnChain
  merge(other: FdnChain): void
  save(): Uint8Array
  verify(): { ok: boolean; brokenAt?: string }               // envelope hash chain
}
```

## Wave 2 signatures

```ts
// render (src/render/) — port of spikes/render learnings into the engine.
interface RenderConfig { viewport: FdnViewport; deviceScaleFactor?: number }
interface LayoutEntry { id: string; x: number; y: number; width: number; height: number }
renderHtml(html: string, config: RenderConfig):
  Promise<{ png: Uint8Array; layout: LayoutEntry[] }>
// Bakes then renders every matrix cell (or the given state/viewport subset).
renderDocument(doc: FdnDocument, opts?: { state?: string; viewport?: string }):
  Promise<Array<{ state: string | null; viewport: FdnViewport; png: Uint8Array; layout: LayoutEntry[]; report: ConformanceReport }>>

// diff (src/diff/)
visualDiff(a: Uint8Array, b: Uint8Array):
  { identical: boolean; diffPixels: number; width: number; height: number; diffPng: Uint8Array | null }
conformanceDiff(a: ConformanceReport, b: ConformanceReport):
  { added: ReportLine[]; resolved: ReportLine[] }

// serve (src/serve/) — node:http + SSE live reload, no new deps.
serveDocument(filePath: string, opts?: { port?: number }):
  Promise<{ url: string; close: () => Promise<void> }>
```

## Wave 3 signatures (Phase B)

```ts
// chain exchange (src/chain/) — blob-directory wire format (SPEC 13a)
exportBlobs(chain: FdnChain, dir: string): Promise<{ written: number }>
importBlobs(chain: FdnChain, dir: string):
  Promise<{ imported: number; overlaps: OverlapReport }>
mergeChains(a: Uint8Array, b: Uint8Array):
  { merged: Uint8Array; overlaps: OverlapReport }
interface OverlapReport { lines: ReportLine[] }  // code "concurrent-overlap"

// document id: minted by CLI at creation (crypto.randomUUID), stored as
// data-fdn-doc-id on fdn-doc + chain meta; parse/project roundtrip it verbatim.
```

New CLI commands: `chain push|pull|sync <file> <dir>` (blob exchange against a
mailbox directory) · `chain merge <file> <theirs.chain>` (engine merge + overlap
report + regenerate text) · `git-merge-driver` (three-arg git driver; install
notes for .gitattributes) · `gateway install` (publish ~/.hive/gateways/
foundation.json) · `mcp` (stdio MCP server exposing the verb set).

## Wave 4 — component importer (packages/importer, new package)

The D3 importer: external React components → FdnComponent, transparent-first.
Two stages with a FIXED intermediate artifact so they can be built independently.

```ts
// Stage 1 — compile + sandboxed render harness (src/harness/)
harvestComponent(opts: {
  source: string            // path to a .tsx/.jsx component file
  name?: string             // default: inferred from export/file
  props?: FdnProp[]         // override; else best-effort from TS types (string |
                            // boolean | string-literal-union → enum; else require override)
}): Promise<RenderArtifact>

interface RenderSample {
  /** Which prop was varied from defaults for this sample; undefined = the
   *  baseline (defaults + sentinel strings). */
  varied?: string
  props: Record<string, unknown>
  html: string              // renderToStaticMarkup output
}
interface RenderArtifact {
  name: string
  propSchema: FdnProp[]
  samples: RenderSample[]   // baseline first, then one prop varied at a time:
                            // every enum value, both booleans. String props are
                            // NOT varied — the baseline uses sentinel values
                            // "⟦fdn:prop:<name>⟧" for substitution detection.
  classIndex: Record<string, {
    base: Record<string, string>                      // class → declarations
    states?: Partial<Record<'hover'|'focus'|'active'|'disabled', Record<string, string>>>
    unsupported?: string[]  // variant prefixes we cannot express (md:, dark:, …)
  }>                        // resolved Tailwind declarations for every class
                            // appearing in any sample (tailwindcss compiled
                            // against exactly that class set; deterministic)
  provenance: { source: string; contentSha256: string }
}
// Determinism enforced in the SSR sandbox: frozen Date, seeded Math.random,
// banned globals (fetch/XHR/WebSocket/localStorage/timers) throw legible
// errors. esbuild pinned; bundling resolves from the component's own package
// context; no network ever.

// Stage 2 — projection (src/project/)
projectArtifact(artifact: RenderArtifact): {
  component: FdnComponent   // native body when projection succeeds, else sealed
  mode: 'native' | 'sealed'
  report: ReportLine[]      // codes: import-sentinel-substituted, import-variant-branch,
                            // import-attr-ternary, import-prop-interaction (→ sealed),
                            // import-unsupported-variant (dropped md:/dark: etc.),
                            // import-unprojectable-css (→ sealed), import-sealed
}
// Projection rules: sentinel strings → {{ prop.x }} in text/attrs; per-value
// structural diffs → when= branches on the varied prop; attribute-only value
// differences → ternary (2 values) or a generated fdn-lookup (3+); Tailwind
// classes → inline declarations via classIndex (base → style, states →
// style-hover/-focus/-active/-disabled), then longhand-normalized exactly like
// D1 ingestion; class attributes are consumed (not emitted). Composed-variant
// check: if applying two single-prop diffs independently cannot reproduce a
// pairwise sample (harness includes a small pairwise probe set for enum×boolean
// pairs), that is a prop interaction → sealed + report. Icons (pure-svg output,
// no classes) project trivially — the degenerate case.
```

CLI: `foundation import <source> --into <file.fdn.html> [--name N] [--props <json>]
[--sealed]` (--sealed forces capsule mode) — appends/replaces the component in the
target document via ordinary ingest+commit (chain-committed when a chain exists),
prints the report. MCP: `foundation_import { source, into, name?, props?, sealed? }`.
Bake: sealed components emit `<div class="fdn-capsule-<name>">` + their css scoped
under that class in the baked document's style block.
Acceptance suite: vendored fixtures — ShadCN-style button (cva variants), badge,
card, and a lucide icon — imported natively, validated, baked, rendered; repeated
import byte-identical.

## CLI (packages/cli)

Zero-dependency argv parsing, bin name `foundation`. Commands v0:
`new <name>` · `inspect <file>` · `validate <file>` · `ingest <file>` (normalize
in place + print report) · `bake <file> [--state S] [-o out]` · `render <file>
[--state S] [--viewport V] [-o dir]` · `diff <a.html> <b.html>` (structural via
parse + visual via render) · `serve <file> [--port]` · `chain <file> log|verify`
(operates on `<file>.chain` beside the document when present). Exit codes:
0 ok, 1 validation errors, 2 usage.

## Canonical text rules (project)

- 2-space indent; one attribute order everywhere: `id`-attr? no — order is:
  `data-fdn-id`, `class`, ordinary attrs sorted alphabetically, `when`, `each`,
  `data-fdn-style` (styleRef), `style` (declarations sorted alphabetically),
  `style-hover|focus|active|disabled` (in that order, declarations sorted).
- Document sections in fixed order: `<fdn-doc>` header (params, data, lookups,
  states, matrix) → `<fdn-styles>` → `<fdn-component>` definitions (alphabetical)
  → `<main>` body. All metadata elements carry `hidden`.
- `<style>` block contains ONLY `:root { --token: value; }` lines, sorted.
- Stable node ids serialize as `data-fdn-id`.
- No trailing whitespace, LF endings, single trailing newline.

## Node identity

`parseDocument` mints ids for elements lacking `data-fdn-id`: `n<counter>` where the
counter continues from the highest existing minted id in the document. Minting is
deterministic for a given input text.

## Test fixtures

`boards/system-help-center.fdn.html` and `boards/overlay-evidence.fdn.html` are the
primary fixtures (parse → project fixpoint; bake of at least one declared state each).
`boards/inbox-unified.fdn.html` is stretch. Synthetic micro-fixtures per module are
expected and live in the module's test directory.

**Standing rule (post-dogfood, 2026-07-31): every fixture that validates clean must
also bake non-trivially** — a validator acceptance test whose document bakes to
empty/hollow output is a contract split between validate and bake (the each-over-data
bug shipped exactly this way: valid and hollow simultaneously).

## Artboard API and session 0.2

`artboardPages(doc)` and `boardViews(doc)` provide ordered page descriptors and
all native/generated occurrences, including hidden previews. `boardView(doc,
{artboardId,state,viewport})` resolves one effective position, size and overflow
policy. `boardKey(ref)` is the stable tuple cache key. `selectArtboard(doc,id)`
selects one design body; `validateArtboards(doc)` reports structural issues.
Legacy bodies use `artboardId:null`. Explicit IDs always identify source nodes.

`bakeDocument` and `bakeEditorDocument` accept `{artboardId?,state?}` and return
`artboardId` alongside existing output. With several artboards an omitted ID
reports `ambiguous-artboard` and emits no content. `renderDocument` additionally
accepts `{artboardId?,pageId?,matrix?}`. Explicit designs default to each selected
artboard's native dimensions; `viewport` chooses a named preview including a
saved local size override; `matrix:true` enumerates declared matrix cells.
Clipped artboards capture exactly the artboard bounds. Visible and legacy
artboards preserve their existing overflow capture policy.

Session protocol is `0.2`; no `0.1` adapter is provided. The `view` request uses
`boards:[{artboardId,state,viewport}]`, `components`, and optional `bakeDiffs`.
Welcome/doc messages carry `pages` and `boards`; all baked/baked-diff messages
carry the complete `BoardView` descriptor. Diff offsets remain UTF-16 and bases
are tracked independently per tuple. Geometry-only edits update doc descriptors
without content bakes. Missing subscriptions are removed from bake caches without faulting; the doc
board inventory tells clients which previews were removed. All legacy/explicit transitions (including peer sync and Undo/Redo) rekey
subscriptions when the explicit side has exactly one artboard, deduplicating
the result. `unavailableBoards` in doc snapshots explicitly lists genuinely
missing subscribed tuples; requesting missing views returns a current snapshot.

`ArtboardOp` in the vendored document types defines page/artboard CRUD,
identity-anchored reorder, duplicate ID maps, preview placement/visibility/size,
shared viewport resize and guarded separation, declaration rename and explicit
legacy upgrade. They expand under the same transaction lock into ordinary
PatchOps. `set-spec-version` is the granular format-version primitive. One
semantic batch is one change; malformed or conflicting operations make no
writes. All new operations work through `foundation edit FILE --ops JSON` or
`--ops-file FILE` and the MCP tool `foundation_edit {path,ops,label?,author?}`.
These one-shot writers have no persistent Undo stack; live sessions retain
writer-local Undo/Redo.

CLI bake accepts `--artboard ID`. Render accepts `--artboard ID`, `--page ID`,
`--matrix`, existing state/viewport/scale selectors and output forms. Single-PNG
JSON adds `artboardId` for explicit boards. Directory exports use encoded stable
IDs and write a manifest. MCP bake/render use `artboardId`/`pageId`/`matrix`.
Vendoring must copy document.ts/session.ts/PIN from the same runtime commit;
ship Foundation service and Apiary client as one supported protocol pair.
