# Foundation — L0 Specification (skeleton)

**Spec version:** 0.0.1-draft · **Date:** 2026-07-30 · **Author:** Tormod / Ur Solutions
**Status:** skeleton — the four one-way-door decisions are argued; everything after them is
scaffolding with intent notes, to be filled as the engine (L1) forces precision.

Foundation is a methodology and a technology for agent-first HTML design iteration.
This document is the methodology made checkable: a closed grammar, a truth model, a
component contract, and a projection rule. Everything else — the engine, the protocol,
the surfaces — consumes this spec and has no authority over it.

The name is the thesis. In a hive, *foundation* is the pre-embossed wax sheet placed in a
frame: it does not build the comb, it constrains where and how comb can be built. An
opinionated substrate, not a tool.

**Independence stance.** This spec depends on nothing from Apiary, Hive, or Valhall. It
must be implementable by a third party from this document plus the conformance suite.
House integrations (gateway registration, peer sync, comment-mode tee) live in L2/L3
documents, never here.

---

## 1. Terminology

- **Document** — one design artifact: a chain of changes plus the current materialized state.
- **Change** — an immutable, hash-addressed operation batch appended to a document's chain.
- **Anchor** — a named, human-meaningful pointer into the chain (what v0.1 called a snapshot).
- **Projection** — the canonical deterministic text form of a document state.
- **Subset** — the closed HTML/CSS grammar of the document layer (D1).
- **Component** — a named, parameterized, reusable definition: typed props, slots,
  variants. Its body is **native** (subset nodes, fully transparent) or **sealed**
  (a compiled capsule) — see D3.
- **Instance** — a placement of a component with prop bindings and sanctioned overrides.
- **Capsule** — the deterministic compiled body of an imported external component
  (React/Svelte/…): scoped markup + styles; internals excluded from the edit and diff
  surfaces.
- **Token** — a named design value (color, space, type, radius…); the preferred,
  auditable value channel. Raw values are also legal — see D1.
- **Param** — a declared document input; **state** — one assignment of params;
  **matrix** — the declared set of states × viewports a document renders under.
- **Design system document** — a document whose exports (tokens, components, named
  styles) other documents inherit; the Product-level unit.
- **Freeze** — emitting a projection + lock into a repo as a reviewable artifact.

---

## 2. Decisions (one-way doors)

Four decisions are load-bearing and effectively irreversible once documents exist in the
wild. They are argued here in full. Nothing else in this spec has that status.

### D1 — The document layer is a closed subset of HTML: closed by schema, not by vocabulary.

The grammar is spelled in real HTML wherever HTML has a word for the concept:

- **Structure:** a broad allowlist of HTML5 elements — nearly the full semantic and
  presentational vocabulary, semantic tags expressly included; the list worth writing
  down is the *exclusions* (scripting, embedded browsing contexts, event-handler
  attributes — §3). `fdn-*` custom elements exist only for semantics HTML lacks:
  component definitions, instances, slots, conditionals. Closure does its work in
  attributes, styling, and values, not in the tag list.
- **Layout:** flex and grid composition, plus free placement inside explicit frames
  (§3a). No floats. Absolute positioning requires a direct frame parent or the
  sanctioned overlay context; fixed positioning still requires an overlay.
- **Values:** arbitrary values are legal — `padding: 13px` is a valid document, not an
  error. Tokens (CSS custom properties, `padding: var(--space-4)`) are the preferred
  channel and the one the conformance plane audits against a design system: off-token
  values are *reported*, never rejected. What is constrained is **form, not choice** —
  values are stored in one canonical form, and context-dependent constructs (complex
  `em` chains, ambiguous percentages) are resolved to predictable units at ingestion.
- **Cascade:** styles attach to nodes or named styles; no descendant selectors, no
  specificity games, no `!important`. Style resolution is local and total.
- **Script:** none in the document layer. Conditional UI is declarative (§4).

Why a closed subset: agents are unreliable at open CSS because open CSS is ambiguous —
five ways to center a box, non-local cascade effects, unitless magic. A closed subset
makes agent edits *semantically diffable*, renders deterministic by construction, and
turns "does this follow the design system" from a review opinion into a validation
result. The subset is to design what a type system is to code.

Why HTML syntax and not an invented vocabulary: closure lives in the schema and the
validator, not in the tag names. Agents are natively trained on HTML and humans read it
fluently; an invented lexicon spends that prior and buys nothing the validator doesn't
already provide. Generation fluency comes from the training distribution; reliability
comes from the validation loop — take the first where it's free, enforce the second
where it's cheap.

**Liberal ingestion, strict projection** (with D4): input may be loose, and
normalization is **lossy but total**. Agents write ordinary HTML and CSS; the ingester
converts as well as it can — structures map to their subset equivalents (`float` →
flex on the parent), loose CSS (inline, classes, stylesheets) is lifted into the
node/named-style model ("styles directly", never stylesheets in the canonical form),
and unsupported *constructs* are rewritten to canonical equivalents (complex `em`/
`rem` chains resolved to predictable units, shorthands expanded) — each rewrite an
**exact, spec-fixed rule with one deterministic output**, never best-effort. Values
themselves are not policed (D1): 13px stays 13px. Hard rejection is reserved for the
unrepresentable: script and behavior. Every conversion emits a **normalization
report** naming each rewrite and each drop — the report and the validator's corrective
errors are the teaching mechanism, and the conformance fixtures enumerate common HTML
and CSS with their required normalizations. That is how the uncanny-valley risk ("it
looks like HTML, so surely all of HTML works") is managed: not by refusing loose
input, but by making every transformation legible.

Alternatives rejected:

1. **Full HTML/CSS with lints.** Rejected: lints are advisory, so every guarantee
   downstream (deterministic render, semantic diff, token audit) becomes probabilistic.
   The whole engine inherits the ambiguity we built Foundation to remove.
2. **An invented element vocabulary** (`frame`, `text`, `overlay` — this spec's own
   first draft). Rejected: fights the training prior of every agent and the reading
   fluency of every human for a closure guarantee the schema provides anyway, and
   degrades the projection's browser-openability from "renders meaningfully" to
   "renders as nothing."
3. **Tailwind-classes-as-the-subset.** Rejected: Tailwind constrains values but not
   structure or cascade, ties the format to a third party's release train, and its
   class-string encoding is hostile to structural diffing. We steal its lesson
   (constraint wins) and not its encoding.
4. **A proprietary JSON scene graph (Figma-style, GrapesJS-style — the Veft v0.1 plan).**
   Rejected: loses the single biggest asset of HTML-native design — the projection is
   viewable, greppable, and reviewable everywhere — and re-creates the translation-loss
   problem Foundation exists to kill.

### D2 — Truth is a hash-linked chain of changes. Undo is a new change.

A document is an append-only DAG of immutable, content-addressed changes. The
materialized state is a pure fold over the chain. Cmd+Z appends the inverse change;
history is never rewritten. Anchors name points in the chain; freeze pins one.

**Granularity (resolved 2026-07-31):** one change = one patch-verb batch = one undo
step = one authored unit (one envelope, one hash, one author, one message).
Finer-grained input — keystrokes, drag ticks — batches client-side before commit and
never enters the chain individually.

**Concurrent same-file writers (G16, 2026-10-23):** updated Foundation sessions,
CLI commands and MCP tools coordinate each read/merge/apply/save transaction with
one exclusive document lock. A successful acknowledgement follows saving both the
latest chain and its projection. No cooperating writer may replace the chain with
a snapshot missing a previously acknowledged change. Later transactions observe
earlier ones; a later write to the same node property wins. Offline CRDT merges
retain causal ordering and deterministic peer tie-breaking, not wall-clock ordering.
A pending-save record lets the next writer finish an interrupted projection after
a process exits. Busy or invalid transactions fail visibly; they are never reported
as saved. All same-file writers must use this protocol; older executables and tools
that overwrite chain bytes directly do not participate.

Each live session owns its Undo and Redo stacks. Undo appends only the granular
inverse of that session's edit, applied to the latest merged document, even if a
peer subsequently changed the same property. Unrelated peer properties survive.
Nested declaration inverses, including component sets, preserve unrelated current
fields and identity-keyed entries.
Redo replays the writer's original values, not a peer's overwritten values. Neither
operation restores a whole-document snapshot. Undoing an inserted container moves
peer-added descendants to its parent at its former position before removing the
container. Targets moved to another parent, missing targets and invalid restores
fail explicitly and skip the obstructed step, so the next Undo reaches older edits.
Transient busy/write failures retain the step. Structural restores use sibling
identities rather than stale indices. Stacks remain local to the running writer and are not reconstructed on reopen.

**Recorded wall-clock time (2026-10-23):** a caller may supply an optional UTC
ISO-8601 `wallTime` with a change's author and message. CLI and session mutation
boundaries supply their machine's commit time; the engine never reads the current
clock. The optional value is stored inside the packed envelope message, so the
existing hash over exported commit bytes covers it. Older envelopes are unchanged
and report null. This is an observation for activity display, not a merge clock:
causal/Lamport order and deterministic peer tie-breaking remain unchanged. Given
identical document, operations, explicit writer identity and supplied metadata, the
engine remains deterministic.
An external-file ingest records when the ingest was committed; it does not recover
the original editor's clock or identity.

**Incremental activity reads (2026-10-23):** the additive session request
`{t:'activity',id,limit,since?,cursor?}` returns
`{t:'activity',id,entries,frontier,nextCursor,hasMore}`. A first read with neither
token establishes the current frontier and returns no history. Later reads use
`since`; page continuations use `cursor` alone. Positive limits are capped at 200
envelopes. A drain fixes its target frontier across every page; the reader advances
its watermark only after the final page. Writes arriving during paging, including
imports older than the previous head in sort order, belong to the next drain.
Order is newest-first causal/Lamport order with numeric peer and counter ties,
not wall-clock order. Facts and envelope fields match the existing log API.

Tokens bind causal frontier points and their envelope hashes to the document.
Malformed, foreign or unavailable tokens produce an id-bearing `invalid-op`
result requiring a new baseline, never an empty or truncated substitute. A read
does not create a chain: an unchained document has empty history, and its first
later chain is reported from the init envelope onward. Without a document id,
that empty baseline is local to the running session; chain-backed tokens survive
restart while their history remains available. Existing log/history APIs are
unchanged. Activity reads enumerate only uncovered Loro change spans and decode
at most one page of facts; they do not enumerate or sort covered history.

**Replica identities and origin (2026-10-24):** annotation ids are collision-resistant
UUIDs (`a-<UUID>`); existing `aN` ids remain readable. Each default chain create/load
opens a fresh writer identity (UUID ids/default actors are intentionally random); callers supplying actors must keep them unique across
writable replicas. Optional `originNode` is stored inside the hashed envelope message
and exposed with `wallTime` (old envelopes report null); CLI/session/MCP boundaries
supply `FOUNDATION_ORIGIN_NODE` or the hostname, never the engine. That machine
name becomes permanent shared history; the environment override can provide an alias. Patch/insert ids
are caller-owned and must be unique across replicas. Deterministic parser `nN` ids,
import reminting and detach ids are source-local: offline writers creating nodes
must assign distinct ids before syncing; these are not replica-safe id allocators.

Why: this gives multiplayer (changes merge), local-first (chains sync lazily and
offline), audit (every change carries authorship — `agent:<bee>` or `user:<id>`), and
time-travel diffing ("render anchor 12 vs anchor 9") from one primitive. It is also the
only truth model under which *agents and humans are the same kind of author* — both
just append changes.

This is not novel technology and must not be built as if it were: it is the
CRDT-with-retained-history category. **Trade study (open, blocking L1):** three
candidates, and the decisive criterion is **tree move** — the document is a DOM tree,
reparenting is a core agent verb, and naive approaches duplicate subtrees or create
cycles under concurrency. **Loro** (lean): git-like op DAG, frontiers time-travel,
fork/merge, and production movable-tree/movable-list types — the only candidate
covering history semantics *and* move natively; younger project, op identity is
(peer, counter) not cryptographic hashes. **Automerge 3**: D2's architecture verbatim
(SHA-256 change DAG, native authorship/messages, built-in diff-between-heads; the old
memory objection died with 3.0's ~10× reduction) — but move is published research, not
a shipped operation. **Yjs** (demoted): merge kernel only — no content addressing, no
change metadata, history fights compaction, no move; the entire chain layer would be
hand-rolled around it, and the "house rails" advantage is small since L2 owns sync
regardless. Whichever wins, a thin **Foundation change envelope** (author, message,
spec version, SHA-256 over the envelope) wraps library change blocks: freeze locks and
chain-head hashes are Foundation's own, the spec never names the library normatively,
and migration is replay. The spec fixes the *semantics* (immutable DAG, inverse-change
undo, anchors); the engine picks the implementation.

Alternatives rejected:

1. **Git as the version store** (the adversarial-review position). Rejected as the
   *truth* layer: git's grain is the commit, and design iteration produces dozens of
   sub-review states per hour that must merge live across authors; git cannot merge
   concurrent edits to one file without a human. Git remains the *distribution* layer —
   frozen projections live in repos (D4).
2. **Mutable current-state + snapshot copies** (Veft v0.1's SQLite model). Rejected:
   loses merge, loses authorship-per-change, makes undo destructive, and multiplayer
   would have to be bolted on later against the data model.

### D3 — Components are first-class citizens; external code enters through an importing compiler.

Users and agents must be able to think in higher-level reusable components, not raw
HTML — so the component model is native to the grammar, not an attachment:

- A **component** is a named, parameterized definition — typed props, slots, variants —
  living in a document or a Product design-system document. An **instance** places a
  component with prop bindings and sanctioned overrides. Both are grammar primitives
  (§3): visible in every surface, selectable, movable, diffable. "`Button.primary`
  padding token changed" is one semantic change that ripples to every instance — not N
  text edits.
- A definition's **body** is one of two kinds:
  - **Native** — subset nodes. Fully transparent: editable, diffable, token-audited
    like any other content. The default, and what agents create when they extract
    repetition into a component.
  - **Sealed** — a compiled **capsule** (scoped markup + arbitrary CSS) produced by the
    importer. Internals are excluded from the edit and diff surfaces; the props
    contract, placement, variants, and layout participation remain fully manipulable.
    The capsule retains structure metadata (internal node geometry) so surfaces can
    anchor annotations *inside* it even though edits cannot reach there.
- **The importer** (a sidecar toolchain) brings external components — React, Svelte,
  ShadCN, icon sets — into the model: source + pinned dependencies + declared props
  schema → a content-addressed component definition, deterministically. It is
  **transparent by default**: render output is projected into the subset through the
  same lossy-but-total normalization as any other input (D1) — canonical rewrites,
  normalization report — and emitted as a *native* body: editable,
  ejectable, linked back to its source for divergence tracking. There is no fidelity
  gate; the report, not a threshold, carries the loss. The sealed capsule exists only
  for output normalization cannot represent at all (canvas-drawn internals,
  pseudo-element art). Either way, **determinism is enforced at
  compile, not requested**: no network, frozen clock, seeded randomness; banned APIs
  (storage, timers beyond animation, IO) fail the compile with a legible error.
  "Presentational only" is a compiler guarantee, not a norm.

Sealing is therefore a property of a definition's *body*, never of componenthood:
every component, native or sealed, is equally a first-class, visible, manipulable
citizen of the document. Icon libraries are the degenerate case of the import contract
(props: `name`, `size`, `color` — token-bound) and need no separate mechanism.

Alternatives rejected:

1. **Inline the render output into the document.** Rejected: breaks D1's closed grammar
   and poisons the diff surface with generated noise.
2. **Live-mount components at render time** (import from `node_modules` in the
   renderer). Rejected: render output now varies with the consumer's dependency tree —
   two machines disagree about what the design *is*.
3. **Curated component whitelist only.** Rejected: recreates the walled-garden pain
   Foundation exists to remove; the contract, not curation, is the boundary.
4. **Opaque-embeds-only** (this spec's own first draft: external components as sealed
   glyphs, no native component primitive). Rejected: makes components second-class —
   invisible internals, props-only interaction — and leaves users and agents thinking
   in raw HTML everywhere except at sealed boundaries, defeating the point of a
   component model.

### D4 — The chain is truth; the projection is canonical, deterministic text.

Live collaboration needs the chain (D2). Agents, repos, editors, and PR review need
text. Both are served by one rule:

- Every document has exactly one **canonical projection**: a deterministic,
  stable-ordered, whitespace-normalized text serialization in the subset grammar —
  the **unresolved template form** (parameterized content symbolic; resolved
  per-state trees are derived bake artifacts, not canonical text — open question 10,
  resolved)
  (proposed extension: `.fdn.html` — HTML-flavored so browsers and existing tooling can
  still open it; see §7).
- Any edit to projected text — by an agent with a file tool, a human in an editor, a PR
  suggestion — is **ingested**: parsed, validated against the subset, diffed against the
  current state, and appended to the chain as an ordinary change. Text editing is not a
  second truth; it is an input method.
- Live file projections carry an opaque `data-fdn-version` on `<fdn-doc>`, alongside
  document identity, outside `FdnDocument` and canonical bake/render input. It names
  the retained version the text came from. Ingestion diffs that version's canonical
  projection against the edited text and applies those granular changes to the
  latest chain, so a stale buffer does not replay unrelated old values. Preserve
  the marker when editing. Unknown versions fail without rewriting the source.
  After the first authored save, a protected projection receipt rejects text that
  drops its marker. Legacy text before that first upgrade uses the available
  current/last-observed baseline; its true
  former version cannot be recovered. `foundation chain recover <file>` backs up
  unapplied text and any pending journal before restoring the current chain projection.
  Tracked CLI/MCP ingests always commit under
  the caller's author identity. A raw filesystem edit made before that call may
  already have been ingested as `file`; callers needing attribution submit content
  through MCP or use session operations, rather than saving raw text first.
- `set-declaration-order {section,names}` reorders named declarations independently
  of their contents, including component sets. Supported sections are params, data,
  lookups, states, viewports, namedStyles, components, componentSets and
  tokenCollections. Names must be unique and exist; unlisted current declarations
  follow in their existing order. This supports granular text reconciliation and
  Undo without replacing definitions or the document.
- **Freeze** = write the projection + a lock header (spec version, engine version,
  chain-head hash, imported-component artifact hashes) into a repo. Frozen files are dead text with a
  verifiable pedigree — reviewable in the same PR as the component they sit beside, and
  re-hydratable into a live chain on demand.

Alternatives rejected:

1. **Text as truth, chain as cache.** Rejected: concurrent multiplayer edits to one text
   file reduce to git-merge semantics — see D2.1.
2. **Chain as truth, no canonical projection** (export-only, Figma-style). Rejected:
   kills the repo story, PR review, grep, and the independence stance in one stroke;
   agents would be back to manipulating truth through an RPC keyhole.

---

## 3. Document model & grammar — *skeleton*

Intent: real product UI spelled in HTML (D1), permissively. The element allowlist is
nearly all of HTML5 — the full semantic set (`article`, `aside`, `figure`, `time`,
tables, definition lists, …) expressly included, and form controls included as
*presentational* elements (rendered, not functional). The normative list is the
**exclusions**: scripting (`script`), embedded browsing contexts (`iframe`, `object`),
event-handler attributes, live media behavior. On top: `fdn-*` elements for what HTML
lacks — `fdn-component` (definition: props, slots, variants), `fdn-use` (instance
with prop bindings), `fdn-slot` — and `when`/`each` attributes for declarative
conditionals (§4), plus explicit free-placement frames (§3a) and one sanctioned overlay context (open question 2). Everything
outside the grammar is normalized in where mappable (D1) before validation rejects
the remainder.

Decided leans from the grammar spike (evidence: `boards/GRAMMAR-FINDINGS.md`):
inline `<svg>` is legal subset content (embedded content model, not scripting);
`fdn-*` elements and `data-fdn-*` attributes are a **reserved namespace** for grammar
bookkeeping — ordinary HTML attributes (`id`, `aria-*`, `data-testid`) coexist freely;
all metadata/definition elements (`fdn-doc` header block, `fdn-styles`,
`fdn-component` definitions) are **browser-inert** in the projection via the `hidden`
attribute, so a plain browser renders only design content.

To fill: the exclusion list made exact, attribute enumeration per element, full
grammar (schema), node identity rules (stable ids for diff/anchoring/comments), named
styles (see open question 12), inheritance from
design system documents (both boards duplicated their full token + component sets for
lack of it — finding b.6).

### 3a. Free placement inside frames (2026-10-23)

A frame is an ordinary HTML container with `data-fdn-layout="free"` or
`data-fdn-layout="flow"` and inline `position:relative` or `position:absolute`. A
flow/root frame uses relative positioning; a freely placed frame uses absolute
positioning within its parent frame. Both establish a containing block for their
own free children. Free mode also declares inline `display:block`; flow mode uses the container's flex/grid layout. These
attributes and styles are document truth, not editor hints. Existing containers
without this attribute retain their existing behavior. This is an additive grammar
extension under the current spec version; no document migration is performed.

A direct child may opt out of either frame's flow with inline `position:absolute`,
`left:<x>px`, `top:<y>px`, `width:<w>px`, `height:<h>px`, and
`box-sizing:border-box`. x/y are finite CSS pixels from the containing block's
padding edge; width/height are nonnegative border-box CSS pixels. Negative x/y and
fractional pixels are legal. Canonical editor operations clear right/bottom to auto
and child margins to zero. New free children initially pin left/top; the
constraint operations below can change those anchors. Width/height follow ordinary CSS min/max
constraints if present. Frames should declare dimensions when their free children
must define a visible canvas: absolute children do not contribute intrinsic size.

Free children occupy no flow space; other children follow ordinary block, flex or
grid layout in DOM order. Switching a frame mode changes its display only, keeping
children's placement and DOM order. Overflow, clipping and stacking use standard
CSS; the mode adds no automatic clipping or z-index. Nested frames each establish
their own containing block, whether the frame itself is a flow child or a free
child. Its layout mode (block/flex/grid) is independent of its placement mode.
Overlay semantics remain unchanged; fixed positioning
is not enabled by a frame. Position declarations in named styles remain prohibited
because their containing context is unknown statically.

Rotation, flip and axis constraints are authored as native CSS as described below.
Arbitrary transformed-coordinate conversion remains outside this slice; existing
legal CSS transforms keep rendering without migration.
Artboards, pages, sections, guides, selection, zoom/pan, snapping and editor window
arrangement acquire no new document semantics here. Editor viewport measurements
are inputs used to author CSS; they are not a second persisted geometry model.
Bake/export preserve the authored CSS geometry with the existing cascade and
component expansion, with no editor runtime needed.

The session protocol accepts these semantic operations in a normal `commit.ops`
batch alongside existing patch verbs:

- `set-frame-mode {id, mode:"free"|"flow"}` sets the attribute and display,
  preserving absolute positioning on an already-free frame and otherwise using
  relative positioning. Free chooses block display; flow retains inline flex/grid,
  otherwise chooses flex. Children are unchanged.
- `set-placement {id, mode:"free", bounds:{x,y,width,height}}` converts a direct
  frame child using caller-measured, untransformed bounds relative to that frame's
  padding edge, including scroll offset and excluding child margins. The caller
  measures the chosen rendered instance/state before committing. It must account
  for ancestor transforms; ambiguous transformed geometry is outside this slice.
- `set-placement {id, mode:"flow"}` sets static positioning (relative for a layout
  frame) and auto offsets, retaining size. Flow chooses its position by DOM order and layout, so retaining
  arbitrary free x/y is not generally possible.
- `set-free-position {id,x,y,bounds?}` moves an already-free child, preserving its
  canonical constraint modes, rotation and flips. Legacy noncanonical constraints
  keep the older left/top write behavior. Optional measured bounds are
  required when the existing constrained geometry cannot be inferred safely.
- `resize-free {id,width,height,bounds?}` resizes an already-free child, keeping its
  untransformed x/y and updating constraint offsets for the new dimensions. This
  shifts a rotated visual centre; a drag handle that must keep a visual corner
  fixed batches the corresponding position adjustment with the resize.
- `set-free-rotation {id,degrees}` sets a finite signed angle in degrees, around
  the child's centre. It preserves flips and constraint translation.
- `set-free-flip {id,x?,y?}` sets horizontal/vertical local-axis flips; an omitted
  axis keeps its prior value. It preserves rotation and constraint translation.
- `set-free-constraints {id,h,v,bounds?}` converts geometry to horizontal
  `left|right|left-right|center|scale` and vertical
  `top|bottom|top-bottom|center|scale` constraints, preserving its visual position
  at the measured frame size.

Rotation and flip use one canonical CSS transform:
`translate(tx, ty) rotate(degreesdeg) scale(sx, sy)`, with
`transform-origin:50% 50%;transform-box:border-box`. tx/ty are `-50%` for a centred constraint on that axis,
otherwise `0%`; sx/sy are -1 for a flipped axis, otherwise 1. Translation is applied
in frame axes, rotation/flips around the element centre. W/H and x/y inputs refer
to the untransformed border box; a browser's rotated axis-aligned bounding
rectangle is not that box. Rotation does not rewrite width/height. A scale
constraint changes CSS width/height proportionally; the transform's scale is only
for flips.

For one axis, let P be the frame's containing-block extent, x the child's
untransformed leading coordinate, and w its border-box extent. Vertical rules use
y/h instead:

| Constraint | Leading inset | Trailing inset | Extent | Translation |
|---|---|---|---|---|
| left / top | x px | auto | w px | 0% |
| right / bottom | auto | (P-x-w) px | w px | 0% |
| left-right / top-bottom | x px | (P-x-w) px | auto | 0% |
| center | calc(50% + (x+w/2-P/2) px) | auto | w px | -50% |
| scale | (100*x/P)% | auto | (100*w/P)% | 0% |

Thus resizing the frame keeps the chosen edges pinned, preserves a centre offset,
stretches between two pinned edges, or scales position and size. Existing CSS
min/max bounds still govern used dimensions. No separate constraint attributes or
cached workspace geometry are stored; CSS is document truth. Moving or directly
resizing a constrained child updates these declarations, preserving the inferred
axis modes. Conversion back to flow clears constraint translation but retains
rotation/flips; conversion to free left/top placement likewise clears any old
centering translation.

Measured `bounds` has `{x,y,width,height,frameWidth,frameHeight}` in local CSS
pixels. Frame dimensions are its actual absolute-position containing-block
padding-box extents, not its outer border box; account for scroll offsets and
ancestor transforms. All numbers must be finite, child dimensions nonnegative,
and frame dimensions positive. Callers should always measure for token-sized,
flex/grid-sized, padded/bordered, constrained or otherwise ambiguous frames and
children. Without bounds, inference is restricted to unambiguous canonical pixel
boxes with `flex:none` on the frame and no nonzero padding/border, min/max,
margin or other sizing ambiguity. Grid frames/placement and interaction-state
styles require measured bounds. Constraint conversion resets grid-area, grid-row,
grid-column and their placement longhands to auto so the child uses the full
frame containing block. Raw inset shorthands/logical insets must first be
normalized to physical offsets; these are refused even with bounds.
Existing canonical percentage/centre/stretch
geometry can then be resolved against that known frame.

New transform/constraint operations accept no transform, a simple rotate(deg),
unit flips, or the canonical transform above, with the default centre origin
and border-box reference. Non-default transform-box values must be flattened first.
Arbitrary transforms, non-centre origins and individual rotate/scale/translate
properties are refused rather than flattened or discarded. Existing left/top
move/resize and flow conversion keep unrelated legacy transforms intact, including
canonical-looking legacy strings combined with a custom origin or individual
transform properties. Constraint-preserving editing is limited to the supported
canonical form. Calculated CSS retains finite native floating-point precision
without snapping coordinates. These
operations author the base style plane, not a forced interaction-state override.

Geometry operations require an explicit, positioned (relative or absolute)
direct frame parent. Invalid numbers, missing nodes, or missing frame context
reject the whole commit without a revision or undo step. The session expands semantic operations
against the sequential batch state into existing set-attr/set-style patches, then
records one envelope and undo step for the entire commit. Chains store those
primitive patches, not semantic requests. Undo/redo restore the exact previous
attribute/style declarations through writer-local granular inverses; no
replace-document is used. Results and document/bake notifications retain the
existing protocol shapes. Undo history remains session-local.

Session clients may opt in with `hello.earlyResult: true` to receive the durable
document and result before preview bakes. Without it, the existing delivery order
is retained. `view.bakeDiffs: true` permits a `baked-diff` message for a state with
a previously sent preview. Apply its replacement to that state's `baseRev` HTML:
`start` and `deleteCount` count UTF-16 code units, and `insert` replaces that span.
Keep a separate preview revision per state; a full `baked` message resets its base.

### Native component sets and variants

A document may declare `componentSets`, each with `name`, `properties` (axis name
→ nonempty unique string values), `defaultVariant` (one value per axis), and
`variants` (ordered `{values,component}` entries referencing native definitions).
Sparse combinations are legal. Every declared combination is unique and complete;
the default must resolve to one declared combination. A member belongs to one
combination in one set, once; ordinary direct uses of that member remain legal.
Set names share the component namespace and cannot collide with definitions.
Axes use `[a-z][a-z0-9-]*`; values are nonempty case-sensitive strings without
control characters, as are set names and member layer identities. Definition
layer ids are unique within a member and may be shared across members to identify
the same layer across variants. A member's typed props describe nonvariant settings
and must not reuse an axis name; existing `when`, lookups and slots still work.

Canonical inert header metadata uses `<fdn-component-set name="Button"
properties="…" default-variant="…">` with JSON objects escaped as HTML attributes,
and `<fdn-variant component="ButtonSmall" values="…"></fdn-variant>` children.
JSON keys are sorted deterministically. The existing native component bodies stay
in their ordinary definitions. Malformed metadata is reported, and sessions retain
the source and block writes until repair. No mode CSS or editor state is stored here.

An instance uses `<fdn-use component-set="Button" data-fdn-variant-size="sm">`.
Exactly one of `component` or `component-set` is allowed. Literal variant selections
are separate from prop bindings. Omitted axes inherit `defaultVariant`; changing
that default updates unpinned instances. Explicit values equal to a default remain
pinned. Unknown values, extra axes or unlisted combinations are validation errors;
session batches reject newly introduced issues atomically. An invalid instance
omits only that instance and emits a local bake report. Already-invalid instances
from a concurrent merge do not block unrelated edits or repairs. Broken set declarations similarly omit only uses of that set; the rest of the
document still bakes. Validation issue keys use stable subjects, so diagnostic
wording changes do not turn existing errors into new write barriers. Member props not understood by a selected
variant remain on the instance and are reported as inert. Editor output identifies
both the set and selected native definition; set catalog previews show its default.

`set-component-set {componentSet,index?}` and `remove-component-set {name}` are
keyed granular patches with the existing ordered declaration inverse contract.
`set-instance-variant {id,values}` merges supplied axis values, with a null axis value clearing just that axis; `values:null` clears
all explicit axes to the set default. It expands to per-attribute patches, with the
exact previous attributes restored by undo. One commit batch is one undo step.
Set/member removal does not cascade; update references in the same batch. Definitions
and set declarations remain whole named Loro values, so concurrent edits to the
same definition/set use that register's last writer; instance attributes are per key.
Documents without sets retain byte-identical bakes, projections and chain writes.
Variant selections in this slice are literal; driving a nested variant through a
parent prop expression is out of scope and reported as an invalid selection.
Per-use overrides and swaps are described below; detach is a separate slice.
Slot authoring and richer list/record schemas remain outside these four slices.

### Per-use layer overrides

An instance may contain inert `<fdn-override data-fdn-id="…" target="…">`
children alongside `fdn-fill` children. Projection encloses each record in a
`<fdn-overrides hidden>` ancestor, with no model id, so metadata CSS cannot render
in canonical HTML. Parsing flattens these wrappers without changing child order. `target` is a JSON array of stable layer
ids: the first resolves uniquely anywhere in the selected definition, and each
later segment crosses the preceding nested `fdn-use` into its selected definition.
Ordinary ancestry does not enter the address; reordering or reparenting a layer
inside one definition preserves its override. Names are not used for normal
resolution. Repeated `each` occurrences share the same definition target and all
receive the override. Fill content written in a definition belongs to that definition and is
addressable by its stable id; fill content owned by a document use is edited
directly, not through that definition; fallback children of a filled slot remain dormant.

An override stores literal replacement text in its `text` attribute (including
`text=""`), `hidden="true|false"`, ordinary style/state-plane bags, and optionally
`component` or `component-set` plus variant attributes for a nested instance swap.
There are no children, `when`, `each`, named-style reference or element text in
this metadata. Text is literal and wins over prop interpolation; the bake reports
that shadowing. Style/token values are literal CSS including `var(--token)`; template
interpolation is refused in override style bags. Definition named style and own declarations resolve
before the layer override; existing instance-root placement styles still apply
last. Each interaction plane follows the same cascade rule.

`hidden=true` omits the target subtree from derived output, so inline or
interaction display values cannot reveal it. Hidden source layers remain available
in Layers for reset. `hidden=false` removes only the definition's HTML hidden attribute; it never
forces `when`, state scopes or `each` to produce content and does not remove a
separate authored display:none. Reset removes the per-use value.

Definitions remain independent from use-owned overrides. Missing, ambiguous,
sealed, conditionally absent or filled-fallback targets keep their metadata and
emit `override-dormant` reports with the override node id and owning instance.
Conditional/state/filled-slot inactivity is informational; missing or incompatible
targets are warnings. Context-dependent placement diagnostics are warnings so a
master layout edit cannot be blocked by an existing per-use style.
They reactivate when the target returns. Duplicate target records from concurrent
first creation are warnings, never document gates: values merge per property in
child order, later declarations winning. Semantic edits reuse the last record;
clearing one property clears it across duplicates. No stored value is silently
pruned. Override records are excluded from render trees and editor selection ids;
editor bakes mark affected layers with `data-fdn-overrides` field names.

Session `set-instance-override {id,target,values}` merges optional `text`, `hidden`,
`style`, `styleStates`, and `swap`. Nullable text/hidden/swap reset those fields;
null CSS property values reset that property. Swap is `{component}` or
`{componentSet,variants?}`. New non-null edits require a resolvable compatible
native layer; nested swaps require a use target. Reset remains available for dormant
targets. `reset-instance-override {id,target}` removes all records for that target;
`reset-instance-overrides {id}` removes all records on the use, preserving fills.
Operations expand to child insertion/removal and per-key attribute/style patches,
with one commit/undo step. Undo restores exact original record/fill order. New
records get unique source identities once; redo reuses their recorded identity.
Writer-local Undo of a newly created record removes only its authored fields,
retaining unrelated peer fields and the target address. Redo reapplies those fields
to the same retained record identity. An explicit reset still removes the whole
record as the latest edit. Swap attributes form one owned field group, so Undo
and Redo clear or restore the whole swap even after another swap edit. An emptied
record may remain as inert, warning-free metadata after both writers undo their
fields; reset-instance-override removes it. Hidden targets leave their container,
possibly empty.

The parser retains instance fills and overrides while collapsing derived baked
children. Project→parse→project is a fixpoint for canonical fills/overrides. This
also closes the earlier fill round-trip gap; slot authoring beyond that prerequisite
remains a separate workflow. Ordinary documents without such children bake unchanged.

## 4. Tokens, params, conditionals, data — *skeleton*

Intent: tokens are the preferred, audited value channel (D1 — raw values legal);
params drive value variation, declarative conditionals (`when` on nodes), and iteration over declared sample
data — no expressions beyond comparison and boolean composition; if a design needs more
logic, that logic belongs in an imported component. Sample data is declared in-document or inherited
from the design system document, so states are self-contained and renderable headless.
Named-state subtree scopes additionally select authored state copies as described in §4b.
To fill: token taxonomy and theming (light/dark as token planes), param types —
including `enum`, `token`, and structured `list`/`record` shapes (finding b.4: real
component props are lists, e.g. keyboard chord groups) — state declaration syntax, the
matrix declaration (states × viewports), the **interpolation facility** (open
question 9 — the grammar spike found this more foundational than `when`/`each`: props
are inert without a way into text and attribute values), and a bounded value-mapping
primitive (open question 9; finding b.2: enum→style mapping via N `when` branches
scales linearly and badly).


### Instance swap and compatibility preview

`swap-instance {id,target}` changes a source instance to `{component}` or
`{componentSet,variants?}`. Its existing prop attributes, fills, styles and override
payloads remain stored. Selection and target retargeting are one semantic batch,
with exact per-attribute undo. Writer-local Undo/Redo skips derived target
updates for metadata records removed by another writer while still restoring the
instance selection. A swap step whose only remaining effects targeted records
since removed by another writer is skipped. Created-record field ownership follows
the retained record identity and leaves its current target unchanged. If a
creator Undo removed the record after another writer swapped the instance, Redo
reinserts the authored target, which may be dormant under the current selector.
Compatibility previews show whether another selection can revive or retarget it;
previews do not mutate the record.
`set-instance-variant` uses the same planner, as do
nested swap overrides and resetting a nested swap. Sealed targets accept swaps;
all interior overrides become dormant. A newly introduced structural component cycle is refused
before any write, including a cycle hidden behind a current condition. Existing
cycles do not block an unrelated swap or repair.

The planner first matches an exact, unique definition identity at each path
segment. Otherwise it tries `data-fdn-name`, case-sensitive and exact, with the
same tag and the same chain of named ancestors. Names are nonempty strings;
duplicates are legal but an ambiguous descriptor cannot match. Names are read
from the current old definition, never copied onto override metadata. No text,
position or sibling-order heuristic is used. Exact identity wins even when a
layer name differs: renaming does not change identity. Unrelated definitions
that reuse ids therefore count as shared identities; clients should highlight
exact matches whose names differ in the preview. A target already missing in the old
definition can reactivate by exact identity, but cannot match by name. Nested
segments resolve through the selected member and any nested swap overrides.

Only the override `target` attribute changes after a successful name match.
Unmatched records stay stored and dormant; swapping back may revive them. If
multiple distinct old targets would land on the same destination, or a name
match would collide with an existing target, the name match stays dormant with
`retarget-collision`. Existing duplicate records for the same old target move
together, retaining their child-order precedence. A variant switch may retarget
by name; going back can be ambiguous, so clients must show the returned plan.

Results optionally include `componentSwaps`: each plan contains the selected
component/set/values and, per override source id, its old/new target, outcome
`exact`, `retargeted-by-name` or `dormant`, compatible and inactive field names,
and a reason when unmatched. Compatibility describes structure, not whether a
condition currently renders the layer. Props absent from the target are inert;
changed types are reported `reinterpreted` and keep their raw binding; literal
out-of-domain enum values are `invalid-for-target`. Fills absent from the new
slot schema are inert. No payload is silently pruned.

A read-only `preview-instance-swap {id,op}` accepts a `swap-instance` or
`set-instance-variant` operation and returns
`instance-swap-preview {id,rev,report}` without an edit or history entry of its
own. Normal disk synchronization can first ingest and announce pending external
changes. The report includes a deterministic SHA-256 compatibility-plan
signature. Both root operations accept optional `previewRev` and
`previewSignature`: future revisions, stale revisions without a signature, or a
changed signature are refused with `conflict`, asking the caller to preview
again. An unchanged plan may proceed after an unrelated revision. A preview is
a compatibility plan, not a frozen appearance snapshot. Batch reports follow
operation order; a no-op selection returns its report without a history entry.


### One-level chosen-state detach

`detach-instance {id,state:string|null}` replaces a source native instance with
its current content in the explicit chosen state. `null` uses parameter defaults
and is refused when the target, its ancestors, authored fills or outer definition
contain state scopes: choose a named state instead. Unknown states, inactive
instances, sealed targets and instances inside an enclosing `each` are refused
before writes. The selected variant, outer props, conditionals, iteration and
slot content are resolved now. Content belonging only to other outer states is
intentionally not retained. This is a snapshot, not an all-state equivalence.

Nested instances remain linked, with only their authored bindings resolved in
the caller scope. Unbound nested props stay unbound, so later default and body
changes propagate. Their own definition logic continues to run normally.
Inherited overrides into those instances are forwarded with their target prefix
removed; literal payloads are never reinterpreted as expressions. Overrides
consumed into native layers disappear; dormant records are discarded with their
source ids listed in the result. Tokens stay as live `var(--token)` references.
Native layer and retained nested-instance named-style links stay live; resolved
own and override declarations remain above them. Named styles with dynamic
expressions, or a source instance-level placement style link that cannot be
combined with the native links, are refused in this bounded slice.

A single native root takes the original instance id when no semantic wrapper
or preserved fill-root identity is needed. Otherwise an inert `div` with
`display:contents` carries that id, with native children underneath. Its
meaningful wrapper attrs are retained. Such a group is an identity/annotation
carrier; canvas selection must use its rendered descendants' bounds, since it
has no box of its own. Instance root styles apply to the materialized roots,
including interaction planes; free single-root placement retains its box.
Free multi-root/semantic-wrapper cases requiring a positioned group are refused.
Caller-fill rendered children keep their ids where unique; the consumed fill
container has no rendered layer to retain. Expanded occurrences get deterministic
instance-derived ids, checked against document and definition identities.

The native format normalizes text and style declaration order. Detach quotes
literal braces and normalization-sensitive ASCII space runs using existing
constant expressions, leaving ordinary single interior spaces plain. Tabs,
line breaks and other non-ASCII whitespace that would be lost are refused with
a readable reason. CSS shorthand/longhand overlap that cannot safely survive
canonical storage is refused, in base and interaction planes. These refusals
avoid silent appearance changes; a broader native-literal/ordered-style format
is a future slice. No new serialized escape marker is introduced.

Expansion uses one remove/insert batch at the same parent/index, with no
replace-document. Undo restores the exact instance, fills and overrides; redo
reuses its stored ids. Later edits outside the subtree remain independent;
later conflicting edits inside it skip Undo or Redo with a conflict rather than
discarding peer values. Same-id replacement snapshots are checked before either
direction; same-parent sibling reorders stay at their current position, while
cross-parent moves are obstructions. Earlier selector Undo/Redo refuses a target
that is no longer an instance. Ordinary insertion Undo retains its existing
foreign-child reparenting. Successful
results optionally contain `componentDetaches` entries with `instanceId`,
`state`, `snapshot:"chosen-state"`, `rootId`, `createdIds`, `preservedIds` and
`dormantOverridesDropped`. The snapshot flag lets the editor warn that other
outer-state content was not retained. No standalone editor is part of this op.


### 4a. Typed token collections and modes (2026-10-23)

Flat `doc.tokens` remain unchanged. A document may additionally declare
`tokenCollections: {name, modes, tokens}[]`. A collection's ordered, nonempty mode
list defines its default as the first mode. Each token is `{name,type,values}`,
where type is `color`, `number`, `string`, or `boolean`, and values has exactly one
entry per mode. Values are typed literals or `{alias:tokenName}`. Names of tokens
are global CSS custom-property names without the leading `--`, unique across flat
tokens and all collections; grouping a token does not change its CSS identity.
Collection names match `[a-z][a-z0-9-]*`; mode names match
`[A-Za-z][A-Za-z0-9_-]*` and are case-sensitive. Token names use CSS-safe identifiers
`[A-Za-z_][A-Za-z0-9_-]*`.

Color literals in this slice use CSS hex (#rgb, #rgba, #rrggbb, #rrggbbaa) or
`transparent`. Numbers are finite, unitless JSON numbers; a dimensional use can
spell `calc(var(--gap) * 1px)`. Strings are literal strings without NUL, emitted as escaped CSS
quoted strings; booleans emit `true` or `false`. An alias must refer to a declared
same-type token. Canonical compatible flat values (hex color, finite numeric
literal, boolean, quoted string, or an alias to one) may also be alias targets.
Unclassified legacy CSS values are not silently assigned a type. Flat-only
legacy documents keep their existing grammar and bake bytes.

The canonical metadata lives in the hidden `fdn-doc` header, for example:

```html
<fdn-token-collection name="theme" modes="Light,Dark">
  <fdn-token name="surface" type="color">
    <fdn-token-value mode="Light" value="#ffffff"></fdn-token-value>
    <fdn-token-value mode="Dark" alias="ink"></fdn-token-value>
  </fdn-token>
</fdn-token-collection>
```

Literal number/boolean/string value attributes use JSON primitive spelling (strings are JSON-quoted). The metadata
is document truth. Projection adds a derived `style[data-fdn-token-modes]` block
for direct browser rendering; parsing discards that generated block and
regenerates it from metadata. It is not an authored stylesheet escape hatch.
Documents without collections emit no new block and bake byte-identically.

A frame/section selects each collection independently with an ordinary attribute,
for example `data-fdn-mode-theme="Dark"`. Selection is inherited by descendants;
a nested explicit selection wins for that collection. With no selection, the
first mode applies. Clearing selection resumes inheritance. Mode selection is
document truth; choosing an editor preview mode without authoring an attribute
is workspace state and does not alter export.

Bake/export emit plain CSS custom properties with native `@scope` rules, with
identical selectors at each mode boundary and defaults scoped to `:root`. Values
are declared at each element in the scope so aliases resolve in that element's
current mode context, including aliases between collections and flat aliases to
collection tokens. This avoids inherited aliases freezing at an ancestor's mode.
Per-element mode rules may reset an inherited inline custom-property override on descendants; author a mode selection to scope collection values through a subtree. The output targets a full document/iframe, as the existing flat :root tokens do; shadow-root embedding requires an adapter.
Generated scoped rules are a sanctioned derived form; arbitrary authored
selectors/at-rules remain outside D1. Rendering requires native CSS scope support
(as provided by Foundation's pinned Chromium); there is no injected mode runtime.
Aliases that cycle in any simultaneously selectable combination of modes are
refused by validation, patch/session commits and bake. Invalid metadata emits no active mode CSS in projection. Invalid external token edits are preserved on disk and reported as faults; session commits are blocked until the file is repaired. Repair is interpreted as a new file edit against the current model; a stale repaired file can supersede chain changes merged while the file was invalid. Edges in mutually exclusive
modes of one collection do not constitute a cycle.

Session operations use the normal commit batch and standard results:

- `create-token-collection {name,modes}` creates an empty collection.
- `add-token-mode {collection,name,from?}` appends a mode with values copied from
  the named source mode, defaulting to the first mode.
- `rename-token-mode {collection,name,newName}` preserves position/values and
  updates explicit body and component-template selections in the same batch.
- `remove-token-mode {collection,name}` removes its values, refusing the last mode
  or a mode still explicitly selected. Clear/switch selections first, optionally
  in that same commit. Removing the first mode makes the next mode the default.
- `set-mode-token {collection,name,type?,mode,value}` changes one value. A new
  token requires a type and initializes every mode with that value; subsequent
  edits customize modes. This verb cannot change an existing type; a full,
  validated collection update may do so.
- `set-collection-mode {id,collection,mode}` sets a body frame/section's mode;
  `mode:null` clears it.

These expand to keyed `set-token-collection {collection,index?}` and
`remove-token-collection {name}`, plus ordinary attribute/component patches.
Collection primitives have typed inverses; they never replace the document.
One commit is one undo step. Writer-local inverses restore changed collection
fields and token values against the current collection, keeping unrelated peer
values and tokens. Invalid structural restores fail visibly; unrelated collections
and flat tokens remain independent. Candidate batches are validated
before persistence; type/name/mode/alias errors leave revision, document and chain
bytes unchanged. Undo/redo restores prior declarations/attributes and appends
history as usual. Cross-document libraries, moving/renaming collections and
broader color syntaxes are outside this slice.

### 4b. Named-state subtree scopes (2026-10-23)

`data-fdn-state="name"` on a template element scopes that element and its
descendants to one named document state. When baking a named state, an unmarked
element is included normally; a marked element is included only when its marker
exactly equals the requested state name. The marker is a literal, case-sensitive
single name: it is not trimmed, interpolated, or split into a list. Existing
validation warns about undeclared names, including the empty name. Override
metadata cannot carry this marker; scope the instance or its target layer instead.

With no state selected, all scopes remain visible as the existing stacked
overview. An unknown requested state still reports `unknown-state` and uses
parameter defaults; subtree scopes match that requested name exactly. A marker
for an undeclared or empty name is therefore excluded from every valid named
state, but remains visible in the overview.

Scoping happens before evaluating `each`, `when`, component expansion or child
content. Matching scopes still obey `when` and iteration normally. Nested scopes
must all match: a different inner state cannot escape an excluded outer scope.
Unmarked wrappers remain even when all their children are excluded, so their CSS
can retain space. `data-fdn-viewport` does not filter content.

The same selected state follows native component definitions, `fdn-fill`
containers and caller slot content. Slot filling keeps its existing fallback:
when no baked fill content remains, the slot's default children are baked in the
selected state. A marker on `fdn-use` also gates a sealed component; sealed HTML remains
opaque and markers inside that HTML are not interpreted. Component master bakes
use the unscoped overview. Normal, editor, session and render bakes share this
selection rule. Markers on regular emitted elements are retained in baked HTML;
component wrappers keep their existing attribute emission rules.

Excluded nodes remain in the document and can still be edited by id. They do not
appear in the selected state's editor HTML or render layout report; callers must
measure the chosen rendered state. Excluded subtrees are not evaluated, so their
interpolation, style and other conformance reports are absent. Override dormancy
reports also reflect state and slot inactivity. Token-use audits
also reflect only included content; a token used only in another scope can be
reported unused. Document validation and canonical projection remain unfiltered;
changing the previewed state does not mutate the document or chain.

A chosen-state detach consumes the outer scopes into an unscoped native snapshot,
subject to any unchanged ancestor scope. Retained nested definitions keep their
state logic and run in the later render state.

## 5. Render contract — *skeleton*

Intent: pixel output is a pure function of (projection hash × render-config hash).
Pinned browser engine revision, bundled font set, frozen clock, seeded PRNG, animations
disabled, declared viewport set and DPR. Output: per-state PNG + layout report (node
geometry) addressable by content hash — cacheable and comparable across machines and
time.

**Resolved 2026-07-31 (spikes: `spikes/render/RESULTS.md`, `CROSS-MACHINE.md`,
macOS-arm64 vs linux-x86_64):** renders are bit-identical run-to-run per (platform,
pinned browser). Cross-machine, **bundled fonts are the determinism boundary**: with
the same embedded font file, element geometry is float-exact across OS text stacks
(CoreText vs FreeType); all observed divergence came from OS system-font resolution.
The contract therefore: (1) render-time font resolution never touches OS fonts —
generic families map deterministically onto the pinned bundled set; (2) **layout
identity is a hard cross-machine guarantee** (pending adversarial font fixtures —
ligatures, fallback, CJK — before 1.0); (3) pixels are two-tier — byte-identical per
platform, with **linux-x86_64 headless as the reference platform** producing canonical
pixels for freeze verification and QA diffing; renders elsewhere are previews compared
under pixelmatch tolerance.

To fill: exact pinning mechanism, the layout-report schema, capsule hydration rules
at render time.

Node declarations override their named style in the same style plane, including
shorthand/longhand conflicts. Bake emits sorted named-style declarations first,
then sorted node declarations; identical property names retain only the node's
value. Component instance overrides follow the same rule after the component
root's resolved declarations. Each interaction-state plane uses this ordering too.
This is plain CSS declaration ordering, including the browser's usual `!important`
and invalid-declaration behavior. Canonical document projection remains unchanged;
only derived HTML declaration order carries the cascade layers. Bake output HTML
is the rendering artifact; callers must rebake the document rather than clone or
JSON-round-trip a resolved tree and re-emit it, because the internal emitter keeps
layer order on the original resolved style records.

## 6. Diff semantics — *skeleton*

Intent: three diff planes, all first-class engine outputs: **structural** (tree +
property operations between two states, in subset vocabulary — "padding token changed
on `hero.cta`", never byte ranges), **visual** (per-state pixel diff with changed-region
geometry), **conformance** (token/audit delta: new violations, resolved violations).
To fill: diff document schema (this schema is itself a Foundation-adjacent format —
review surfaces will render it), matrix-level rollups.

## 7. Projection & freeze format — *skeleton*

Intent: `.fdn.html` — a constrained HTML5 document with `data-fdn-*` carrying subset
semantics; opens in any browser (degraded but visible), parses with any HTML parser,
validates only with a Foundation validator. Lock header as a leading comment block.
**Decided (L1 parse module, 2026-07-31):** the projection **never self-closes
non-void elements**. HTML5 tree construction silently ignores `/>` on ordinary and
custom elements, so a self-closed `<fdn-use …/>` mis-nests its siblings in every
spec-conformant parser. Ingestion normalizes self-closed `fdn-*` tags to explicit
open/close pairs (report line `self-closing-tag-normalized`); the conformance suite
must carry this fixture class.

To fill: exact serialization order rules (determinism), lock header schema, re-hydration
(frozen file → live chain) and divergence detection (frozen file drifted from chain).

Non-normative forward note — **export backends**: the canonical projection is the sole
source; exports to framework idioms (Tailwind, StyleX, JSX/React, Svelte, vanilla CSS)
are derived, one-way, lossy compilations owned by a later engine module — deliberately
outside L0 and post-1.0, but anticipated: one canonical truth, N derived outputs is a
large part of the format's eventual power. Freeze is not an export — freeze is
truth-preserving; exports are translations for consumption.

## 8. Verbs — the manipulation protocol — *skeleton*

Intent (pillar 3): agents get *semantic* verbs, not DOM RPC and not blind text
overwrite — though blind text overwrite works too, via D4 ingestion. Proposed core:
`inspect` (state + matrix + validation), `patch` (typed operations: set-prop,
set-token-binding, insert/move/remove node, declare param/state, define/extract
component, bind instance props), `render`, `diff`, `anchor`, `freeze`,
`annotate` / `resolve`. Every verb speaks document semantics; none
speak pixels or bytes. To fill: operation schemas, batch/transaction rules, error
vocabulary (validation failures must be legible to an agent mid-loop).

Lookup edits have granular inverses: `set-lookup {lookup,index?}` inserts or
updates one declaration; `remove-lookup {name}` removes it. Undo of a new lookup
removes only that lookup; undo of an update restores its prior value; undo of
removal restores its value and declaration position. `set-component` also accepts
an optional declaration `index` for exact restoration after removal. An index
addresses the list with any previous declaration of that name excluded; omitting
it preserves the current position or appends a new declaration. These verbs use
the ordinary one-batch/one-undo protocol, never a whole-document inverse. Component
prop declarations use `set-component`; instance prop bindings use `set-attr`.

### Per-document-state style values

A style value can use `{{ section-2a-height[state.name] }}` with an ordinary
`fdn-lookup`. `state.name` is the requested document-state name, or the empty
string for the overview and component masters. Undeclared requested states keep
the unknown-state error and use the requested name. The binding follows native
components, variants, slots and iteration. `state` is read-only and cannot be an
iteration alias; only its `name` field is defined. Lookup names are a separate
namespace, so `state[param.key]` remains unambiguous. Lookup identifiers admit
letters/underscore first, then letters, digits, underscores and hyphens.

A state-indexed lookup must declare an empty-key entry as its authored default.
Exact state entries win. A missing named entry uses that default and reports
`lookup-default-used` as a warning; other lookup expressions retain exact-key
semantics. Missing tables/defaults report errors and omit the unresolved style
declaration, including named-style and interaction planes. Other expression
errors retain their existing bake behavior. Values are CSS strings
and do not recursively evaluate expressions. Projection retains the expressions
and tables. T81's state scopes still gate content before evaluation.

`set-lookup-entry {name,key,value}` edits one entry in an existing table. Null
removes that key; identical writes and absent removals are no-ops. Undo restores
only the prior entry, preserving a peer's other entries. Table creation remains
`set-lookup`; its Undo is refused atomically if another writer changed the new
table. A binding-only Undo leaves the table intact. Redo refuses a peer's
same-name replacement. There is no automatic table cleanup. Updated writers on
one file serialize entry updates; offline forks still merge whole serialized
lookup values, without an entry-level merge guarantee.

Creating a private table uses `set-lookup {lookup,createOnly:true}`. It refuses an
occupied name under the transaction lock, including a collision after a stale
client selected its name. Omitting the flag retains deliberate whole-table
replacement. Editors reuse a table only when this property already binds it.

`set-style` accepts `replaceBinding?:boolean`. Replacing a direct state binding
with any different value, including null, needs explicit replacement intent.
An own literal overriding an inherited state binding from the referenced named
style also needs that intent; an absent-own-property reset is a no-op.
Generated placement/move/resize writes do not supply that intent
and refuse destructive replacement. Inverses automatically carry the flag when
needed. Deliberate text edits generate flagged replacements; changes to entries
of an existing lookup generate entry operations. Final-batch validation refuses
new missing-table/default errors. Intermediate operations may temporarily break
those references. Adding states uses the authored default rather than rewriting
every table. An invalid external document is preserved for repair.

Editors should use readable deterministic names such as `section-2a-height`,
with numeric suffixes on collision, never overwriting an occupied table unless
the property already binds it. Names stay fixed when a layer is renamed. A
duplicated layer's shared binding must be shown and copied before its first
divergent edit. Free conversion measures each current state and the overview,
retains fractional values, and batches creation, binding and layout edits.
Missing/stale measurements or differing geometry across relevant viewports must
be refused: these tables are keyed by state, not viewport. Commit base semantics
do not provide a measurement compare-and-swap.

Document states remain independent of variant axes and token modes. Interaction
style planes and the existing cascade are unchanged. Instance placement styles
may bind state lookups; definition-layer override records stay literal. Detach
freezes node-own expressions in the chosen state and keeps its dynamic-named-style
refusal. Lookup edits conservatively rebake all subscribed states and masters.
The entry op and replacement flag are additive protocol fields; envelope shapes
and the protocol version are unchanged.

### Document declarations and matrix edits

Session commits accept `set-param {param,index?}`, `remove-param {name}`,
`set-state {state,index?}`, `remove-state {name}`, `set-data {data,index?}`,
`remove-data {name}`, `set-viewport {viewport,index?}`, `remove-viewport {name}`,
and `set-matrix {cells}`. Named sets replace the whole declaration with that name,
keeping its slot or appending a new one; an explicit zero-based index moves it
within the list after removing its previous slot. Viewport dimensions are positive
integers. Matrix cells retain their supplied order and contain state/viewport names.

Each commit is one undo step. Creating a declaration undoes with its remove op;
replacement restores the previous declaration; removal restores it at its original
index. Matrix undo restores only the previous matrix. No operation replaces the
whole document. Removing a missing declaration succeeds without adding history.
Removals do not cascade: callers update references and matrix cells in the same
batch when renaming or deleting declarations. Existing reference diagnostics still
apply. A view subscription must include a new state to receive its baked output.

Data items are finite JSON records, including nested objects, arrays, booleans,
numbers and null. Legacy string-only items keep their attribute representation.
An item requiring JSON uses `<fdn-item data-fdn-json="…"></fdn-item>` with the
whole record encoded as deterministic, HTML-attribute-escaped JSON. This reserved
attribute preserves field case, types and control characters through projection.
Malformed JSON is retained as a literal attribute and reported during ingestion;
sessions preserve the source and block commits until repaired. Extra attributes
on a JSON item merge underneath its JSON fields and produce a warning.

## 9. Sync & multiplayer — *skeleton*

Intent: chains sync as append-only logs; local-first; any transport (filesystem, peer
replication, a relay server) — the spec defines the log exchange, not the pipe.
Annotations and review state are in-chain (they are changes like any other, so they
sync, merge, and carry authorship for free). To fill: exchange protocol, awareness
(presence/cursors) as an explicitly *non-truth* side channel, auth boundary for
cloud relays.

## 10. Conformance — *skeleton*

Intent: three implementable levels so others can build partial systems on the format —
**F-core** (parse, validate, materialize, project), **F-render** (the §5 contract,
bit-stable), **F-collab** (chain exchange). A public fixture suite defines each level.
To fill: the fixtures.

---

## Open questions

1. ~~Chain library~~ — **resolved 2026-07-31: Loro** (spike:
   `spikes/chain/RESULTS.md`). Loro passed the full concurrency gauntlet including
   G5 move-cycle; Automerge 3 hit the pre-agreed disqualifier on G5 (no native move —
   its parent-pointer workaround orphans a node under concurrent cyclic moves), and
   was also ~40× slower on append with a costlier diff-lift. Conditions bound to the
   decision (see RESULTS.md Recommendation): the Foundation change envelope is
   mandatory from day one (Foundation-owned SHA-256 + author/message over Loro's
   positional op ids), loro-crdt is pinned exactly, and engine time-travel reads
   serialize around Loro's detaching `checkout()`. The ChainAdapter contract was
   implemented twice, so migration-by-replay remains real, and this spec continues to
   never name the library normatively.
2. ~~Overlay coverage~~ — **resolved 2026-07-31** (evidence:
   `boards/overlay-evidence.fdn.html`, findings §f): one `fdn-overlay` primitive with
   `role`/`anchor`/`dismiss` metadata structurally covers dialog, toast, context
   menu, dropdown/popover, and tooltip — no portal primitive needed. The anchor
   vocabulary that emerged: anchor kind (`trigger` | `viewport-center`), an
   `anchor-ref` to the trigger element (which gains `role="trigger"`),
   **preferred edge (author intent) kept distinct from resolved edge (this baked
   instance's already-flipped geometry)**, flip permission, and offset.
   `scrim`/`panel` substructure is optional — the tooltip is the minimal legal case.
   One residue became open question 13.
3. ~~Capsule interactivity budget~~ — **resolved 2026-08-02 (importer kickoff)**:
   a sealed capsule is `{ html, css }` — its scoped stylesheet MAY use
   `:hover/:focus/:active/:disabled` pseudo-classes and CSS transitions/animations;
   it may NOT contain scripts, event handlers, timers, network access, or storage —
   enforced at import compile (banned globals throw legible errors in the SSR
   sandbox), never by convention. Bake scopes the css under a generated capsule
   class. Internals stay excluded from edit/diff; geometry is retained for
   annotation anchoring (D3). Transparent-first stands: sealing happens only when
   projection fails (structural prop interactions, unrepresentable CSS) and always
   with a report line saying why.
4. ~~Transparent-import fidelity~~ — **resolved 2026-07-31**: no fidelity gate. The
   importer always projects to a native body via D1 normalization (canonical rewrites
   + normalization report); sealed capsules only for unrepresentable output. Values
   are never snapped (raw values are legal, D1); the surviving requirement is that
   every rewrite rule the normalizer performs (`float`→flex, `em`-chain resolution,
   shorthand expansion) is specified exactly, with one deterministic output — because
   documents are content-hashed, two conforming engines must produce byte-identical
   canonical form from identical input or sync and freeze verification break.
5. `.fdn.html` vs a non-HTML extension: does browser-openability outweigh the risk of
   people hand-editing projections outside validation? Current lean: keep `.fdn.html` —
   the projection is now real HTML (D1), so it renders meaningfully anywhere, and
   ingestion validates hand edits anyway (D4).
6. Migration: an importer for the existing `.dc.html` explorations — worth it, or
   re-draw the live ones? (`.dc.html` is claude.ai/design's format; Foundation does not
   adopt or extend it — see PRD, rejected alternatives.)
7. Spec governance once third parties build on it: versioning policy, what a breaking
   change to the subset even means for frozen files (lean: frozen files are forever
   valid under their locked spec version).
8. Style lifting: when ingestion normalizes loose CSS "into styles directly", when do
   repeated declaration sets become a shared named style vs stay node-attached?
   (Lean: node-attached by default; named-style extraction is an explicit verb or an
   importer heuristic with a report line — never silent.)
9. ~~Interpolation and the expression budget~~ — **resolved 2026-07-31, widened
   same day by dogfooding**: `{{ … }}` admits: property/data references, ternary
   (nestable via parentheses), comparisons with **refs on either side** (the
   selection idiom `item.id == prop.selecteditemid`) usable both as conditions and
   as boolean values, and references into **declared lookup tables**. Still no
   arithmetic, no method calls, no string operations — the spike's one `.split()`
   need is answered by real `list`/`record` prop types (§4), not expressions.
   Non-Turing, fully auditable. (Original draft allowed only ref-vs-literal
   comparison and no grouping; real boards needed both within hours of use.)
10. ~~Projection semantics for parameterized content~~ — **resolved 2026-07-31**:
    the canonical projection is the **unresolved template document** — one file, one
    hash, all states; parameterized content stays symbolic. Fully resolved per-state
    trees are **derived artifacts** the engine bakes on demand (for serving,
    rendering, review), never hand-edited, marked as generated wherever embedded.
    A bake with no state selected uses each param's declared `default`; a param
    without a default renders empty and is flagged in the conformance report. The
    grammar spike's dual-form hybrid is retired.
11. ~~Interaction-state styling~~ — **resolved 2026-07-31**: sanctioned, enumerated
    per-state style attributes — `style-hover`, `style-focus`, `style-active`,
    `style-disabled` — validator-owned, same value grammar as `style`, no other
    pseudo-class mechanism. (The `.dc.html` precedent, adopted deliberately.) Named
    styles may grow matching state planes in L1 if duplication demands it.
12. ~~Named styles' rendering home~~ — **dissolved by the resolution of Q10**: the
    canonical (template) form keeps named styles symbolic — no dual-carry, so drift
    is impossible rather than detected; only derived baked artifacts inline the
    resolved styles, and those are engine-generated by definition.
13a. ~~Document identity and addressing~~ — **resolved 2026-07-31 (Phase B kickoff)**:
    (i) **Document id**: a UUID minted once at creation (CLI/surface layer — the
    engine stays randomness-free), carried as `data-fdn-doc-id` on the `fdn-doc`
    header element and in the chain's metadata, immutable for the document's life;
    peers and relays pair chains by it. (ii) **Author identity**: CLI defaults to
    `user:<os-username>@<hostname>`, never a shared literal (peer ids derive from
    author strings; shared defaults collide — proven). A nonempty `HIVE_BEE_ID`
    overrides this with `agent:<canonical bee UUID>`, then `HIVE_BEE` supplies the
    legacy name fallback. CLI/MCP mutations and a session with no explicit author
    share that default; explicit flag/hello authors keep their existing precedence.
    Existing history is not rewritten. (iii) **Project manifest**: a
    `foundation.json` in the project
    directory — `{ schema, id, name, documents: [{ path, docId }], designSystem?:
    <path>, viewports?: defaults }`; the filesystem stays the database, the
    manifest is the index. Design-system *inheritance semantics* remain §3 to-fill.
    (iv) **Exchange format**: the chain's wire form is a **content-addressed
    change-blob directory** — `<docId>/<envelope-hash>.fdnc`, one blob per change.
    Append-only + content-addressed makes directory **union** a correct merge, so
    any dumb file-syncer (Syncthing, rsync, iCloud, a shared tailnet folder) is a
    valid transport with no server logic; a relay is just a hosted copy. The
    single-file `.chain` snapshot remains a local compaction/fast-load cache and
    is NOT safe to file-sync (whole-file LWW clobbers appends). Merges report
    concurrent overlapping property writes as review signals. Envelopes are hashed
    but not yet signed — untrusted relays are a recorded future upgrade, and the
    envelope leaves room for signatures.
14. **Boolean attribute presence** (importer Stage 2 discovery, 2026-08-02): the
    grammar can interpolate attribute *values* and gate *nodes* (`when=`), but has
    no way to make an attribute's *presence* conditional — HTML boolean attributes
    (`disabled`, `checked`, `open`) are presence-based, so a component whose only
    variant difference is `disabled` cannot project to a native template and
    correctly seals today. Candidate: `attr-when-<name>="<cond>"` (attribute
    emitted iff cond true), or a rule that an interpolated empty value omits
    known-boolean attributes. Decide before the importer's v2 pass; the sealed
    fallback is correct meanwhile.
13. **Hover-triggered presence** (overlay evidence round 2, findings §f — genuinely
    new, distinct from resolved Q11): a tooltip's *visibility* is gated by another
    node's interaction state — hovering element A decides whether unrelated subtree B
    exists in the render at all. Q11's `style-hover` is same-node styling; presence
    is not a style property. Candidate mechanism: a declarative trigger binding on
    the overlay (`data-fdn-trigger="hover:<ref>"` + `dismiss="none"`), with all
    other overlay shapes continuing to imply visibility from their containing baked
    state. Decide in L1 alongside the bake semantics.

## 15. Artboards and pages (T97)

Explicit multi-artboard documents use `0.1.0-artboards`, or
`0.2.0-artboard-frames` when artboard roots carry authored frame fields. Legacy single-body
files retain their original format and open without writes. Updated writers
refuse unsupported format versions before normalization or persistence. This
cannot make older executables safe: the old parser drops an unknown wrapper
and its entire subtree. All installed writers must be updated or retired
before enabling production upgrades; the Foundation release owner records that
rollout inventory. Development fixtures are disposable copies.

The existing source-node tree stores `fdn-page` at body root, `fdn-artboard`
inside pages, and ordinary design children inside artboards. Both structural
nodes use stable `data-fdn-id` and literal `data-fdn-name`; names may repeat.
Artboards store literal finite pixel numbers in `data-fdn-x`, `data-fdn-y`,
`data-fdn-width`, `data-fdn-height`, with positive dimensions, plus
`data-fdn-overflow="clip|visible"`. Page/artboard DOM order is saved ordering,
independent of canvas coordinates. Pages and view records cannot carry styles,
conditions, iterations, named-style bindings or token-mode selections. Under
`0.2.0-artboard-frames`, the artboard node owns ordinary frame styles,
interaction planes, named-style links, token modes and free/flow layout. It
retains one source identity and no mandatory inner frame. Conditions, iterations
and state scopes remain on design content, not the artboard root.

A preview is addressed by `(artboardId,state,viewport)`, with null state for
defaults/overview and null viewport for native dimensions. Only `(id,null,null)`
is the canonical occurrence: its position and size belong to the artboard.
`fdn-artboard-view` children store optional preview-specific X/Y, visibility and
paired W/H overrides. `data-fdn-view-state` and `data-fdn-view-viewport` select
the tuple; omitted selectors mean null. Records have their own IDs, no content
or styles, and at most one record exists per tuple. Saved positions never
reflow. Unsaved initial placements are derived and may change when declarations
or sizes change. The default browser size is Foundation-owned 1440×900 for
both canvas descriptors and exports. Fractional dimensions stay exact in the
file; the browser viewport rounds to integer CSS pixels as an iframe does,
while PNG capture reports its actual raster dimensions.

States, viewports, matrix, parameters, lookups, tokens, styles, components and
component sets remain document-wide. Existing state scopes and per-state lookup
bindings retain their semantics. Matrix state `""` maps to null. The Components
catalog is synthetic, not a writable user page. Baking selects one artboard,
removes page/view metadata and emits the selected frame through the existing
body emitter. Authored artboard frame fields resolve through the ordinary node
style resolver and render on body, with the raw source id in editor output.
Untouched roots retain their old output exactly. Artboard placement never
becomes content CSS.

Each semantic edit is one granular transaction and one writer-local Undo step.
Legacy upgrade wraps the unchanged body using insert/move operations, preserves
source IDs, declarations, annotations and chain ancestry, and records viewport
preview placements. The first placement gesture combines upgrade plus edit in
one Undo. Undo refuses to delete a created structural container containing
foreign descendants that cannot be retained legally. Shared viewport resizing
commits immediately. A later “Make this board separate” action installs a local
size override and restores the old shared size, guarded against intervening
viewport edits, as a second Undo step.

### Duplicate reference inventory

Duplication requires a complete descendant source-ID map; the new root ID is
separate. It creates fresh IDs for design nodes and metadata, preserves native
component links and definition-local override target paths, and leaves lookup
bindings shared. HTML `id` values receive a root-derived suffix. Local `href`
and `xlink:href` fragments, `for`, `aria-labelledby`, `aria-describedby`,
`aria-controls`, `aria-owns`, `headers`, and `data-fdn-anchor-ref` are rewritten
when their targets are internal. External references remain external. Duplicate
HTML IDs and CSS/attribute `url(#fragment)` references refuse duplication until
an unambiguous rewrite is supported; no heuristic string substitution runs.
Annotations/comments are not duplicated. Redo reuses the original copied IDs
and content, even after the original artboard changes.


### Artboard padding

An artboard accepts optional `data-fdn-padding-top`, `-right`, `-bottom` and
`-left` attributes: finite, non-negative decimal CSS-pixel numbers without
units or expressions. Fractions are allowed, with no additional upper bound.
Absence means zero. Padding attributes on pages/views, unknown padding sides,
negative values and CSS/bindings remain invalid; the wrapper-style refusal is
unchanged.

`set-artboard-padding {id,top?,right?,bottom?,left?}` requires an existing
artboard and at least one supplied side. It expands only changed supplied
sides to granular attributes under the existing writer lock; zero removes the
attribute. A linked four-side edit explicitly sets all four, including any
stale values, using the usual last-edit-wins semantics. One batch gives one
Undo; other writers' untouched sides survive. Undo restores exact prior
attribute strings/presence. Empty/invalid-target requests return `invalid-op`;
malformed wire values retain the protocol fault behavior. Identical nonzero numeric
values and absent zero values are no-ops; setting zero removes an explicitly
stored zero attribute too. Board descriptors carry all four numeric `padding` values
for every occurrence. Protocol remains 0.2; 0.1 retains its existing artboard
write refusal and legacy document behavior.

Standard-frame artboards share a standards-mode normal/editor bake and render/export
body rule: `margin:0;box-sizing:border-box;height:HEIGHTpx;padding:TOPpx RIGHTpx
BOTTOMpx LEFTpx`. HEIGHT is the source-owned effective `BoardView.height` for
the selected artboard/state/viewport occurrence, including saved size overrides;
`bakeDocument`/`bakeEditorDocument` and CLI/MCP bake accept the viewport selector.
It is never derived from a grown iframe or vh units, so overflowing content
cannot stretch a percentage-height Fill child on another measurement pass.
Body width is automatic at the selected viewport width; no width is emitted.
Flow starts at padding; percentage sizes resolve against the fixed content box,
and Free absolute offsets keep their containing-block origin. Bottom padding
is an inset within the declared board height. Overflow remains visible when
requested and exports use the established scroll-height capture policy.

The body rule is last in Foundation's style block, winning earlier body rules
of equal specificity. External CSS follows the normal cascade. No content
wrapper is added. Native/view/viewport height changes invalidate affected
occurrences' baked HTML; viewport declaration edits conservatively rebake all
subscribed boards, without masters. Width-only geometry changes update the
iframe without a new body-height bake. Padding invalidates only its artboard's
subscribed states. Explicit exports share the frame rule and standards mode while retaining
each export's capture bounds. Visible exports use normal bake with
`includeNodeIds`, preserving normal instance layout IDs; clip exports keep
the editor path.

Legacy documents retain byte-identical normal/editor bakes and their existing
render modes and body margins. The artboard-only mode gate is deliberate:
the T97 corpus and T103 Fill probes show legacy layout changes under a global
standards-mode conversion. Upgrade writes `data-fdn-frame="legacy"` on its created artboard and preserves
the old output policy: normal/visible exports retain their existing no-doctype
mode, editor/clip output retains standards mode, and body height and margins
are untouched. The normal/editor mode difference is intentionally preserved.
The descriptor reports `frame: 'legacy'` and actual padding zero; the usual
UA 8px body margin remains an inset in addition to any user padding. Real 8px
padding cannot replace that margin without changing margin collapsing.
Padding edits on a legacy frame add true padding without resetting margins or
fixing body height; bottom padding follows the content. Existing body CSS keeps
its normal cascade. Legacy visible export also retains its prior re-emission
path, including its pre-existing sealed-capsule CSS limitation.

Only upgrade automatically writes the legacy marker. New artboards omit it
and report `frame: 'standard'`; duplicate artboards preserve the source frame.
The marker accepts only `legacy` on an artboard. `standardize-artboard {id}`
removes it, explicitly opting into zero margin, standards mode and the
source-owned fixed-height frame. One Undo restores the marker while leaving
peer padding edits intact. A standard frame is a no-op with no history entry.
Frame edits invalidate only that artboard's subscribed occurrences.
The descriptor always carries `frame: 'legacy' | 'standard'`, including
unupgraded legacy previews. T103's client height forcing still applies to
legacy frames because Foundation does not emit a body height there; it must
step aside for standard frames. Upgrades preserve the measured pre-upgrade
pixels, while standardization is an explicit visible layout change.


### Authored artboard frames (T107)

Ordinary root frame edits expand under the same canonical-path writer lock into
format promotion, per-board legacy padding migration and the requested scalar
operations, in one envelope and Undo. Migrated padding attrs become own CSS
longhands; before migration they have own-value precedence above named styles.
The legacy capture-overflow attr stays capture-only, above named overflow, until
an explicit overflow style edit removes it. It is optional only in the new
format. Authored overflow then determines the descriptor capture policy.

Viewport W/H stays literal native/shared/per-view geometry. Root own, named and
interaction CSS cannot replace it through dimensions/min/max/logical sizes,
margins, insets, aspect-ratio, transforms, zoom or resets. Root display is
block/flex/grid, position may only be relative, and box-sizing may only be
border-box. Descendant frame sizing and T94 bindings keep their existing rules.

For authored roots, a transparent gradient on html prevents body background
propagation while preserving the host matte; html overflow:auto prevents body
overflow propagation. This lets root radius, opacity and child clipping use the
body box. Existing fixed capture bounds still crop exterior effects. Legacy
markers keep the exact old body policy and normal/editor mode difference;
standardization remains a separate explicit operation, never an implicit side
effect of styling. Styled legacy box edges may therefore differ between quirks
normal output and standards editor output.

Protocol 0.2 hello accepts artboardFrames:true. Without it, a document promoted
to the new frame format is read-only: welcome/doc carries readOnly with the
reason, history is disabled, and commit/Undo/Redo/anchor refuse, including after
peer promotion. Legacy0.1 negotiation keeps its existing first-board read-only
adapter. Updated semantic CLI/MCP editing declares frame support. File-format
promotion is document-wide and older T105a writers refuse the new version.


### Read-only session mode

A hello may request `mode:"read"`; `foundation session --read-only` enforces
the same mode even when hello omits it. It is latched before document locks,
recovery, directory creation or opening. The welcome acknowledges only an
active reader with `mode:"read"`. Ordinary writer packets are unchanged.
Unknown mode values are malformed on an updated server. Older servers ignore
the additive hello field and omit the acknowledgement; Apiary intentionally
keeps its existing reader behavior in that fallback until its minimum runtime
includes this capability.

A reader never acquires a document lock, creates a document/chain/docId,
recovers a pending save, ingests text or persists source/projection/history.
Commit, Undo, Redo and anchor requests return id-bearing `invalid-op` results
with a read-only-session reason. Read views, subscriptions, swap previews,
log and incremental activity remain available. History actions are disabled
and the document view reports the read-only reason. Renegotiating hello
cannot change the mode. `--create` cannot create a missing read-only file.

When a saved chain exists, the reader adopts each atomically published chain
snapshot directly. It does not merge local state or create ingest envelopes.
A chainless file is parsed for viewing without minting an identity. Source
text missing, malformed or different at the parse(project(chain)) boundary
adds an informational `read-only-source-pending` issue; the saved chain remains
authoritative. The flag may appear briefly between a writer's chain and HTML
renames and clears on a later refresh. No recovery is attempted, even when a
pending journal exists. Un-ingested text edits are disclosed, not displayed
as committed history. Reader and writer activity tokens are interchangeable
for the same saved lineage; the existing docId-less baseline remains local
to its session. A changed chain reloads from its snapshot, retaining the
existing cold-load cost; unchanged bytes are reused.
