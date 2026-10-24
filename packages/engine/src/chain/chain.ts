import { encodeOriginalUpdates, OriginalUpdates } from './originals.js'
import { artboardActivity, explicitArtboards, assertFormatVersion } from '../artboards/index.js'
/**
 * FdnChain over loro-crdt (LoroDoc + LoroTree movable tree) — the Foundation
 * chain module (SPEC D2 + resolved open question 1). Ports the proven
 * patterns from spikes/chain/src/loro.ts (LoroTree for hierarchy, one
 * LoroMap per node for attrs/style/styleStates, deterministic peer-id
 * derivation, {author,message} packed into the commit message, save/restore
 * around detaching checkout(), TreeID<->NodeId bookkeeping) and extends them
 * to the full FdnDocument (tokens/params/data/lookups/states/viewports/
 * matrix/namedStyles/components), the Foundation envelope hash chain, and
 * undo via PatchOp inversion. See model.ts for the Loro-free op-inversion and
 * structural-diff logic, and envelope.ts for the exact hash method.
 *
 * Container layout (one LoroDoc, all containers are roots on it):
 *   - `tree`: LoroTree. Each top-level FdnDocument.body[] entry is a Loro
 *     tree ROOT (no single wrapping root node — body is genuinely an array,
 *     and LoroTree supports multiple roots natively, ordered like siblings).
 *     Every node's `data` map holds: id, tag, text, styleRef, when, each
 *     (scalars, null = absent) plus THREE child containers for the fields
 *     PatchOp can address at key/prop granularity: `attrs` (LoroMap),
 *     `style` (LoroMap), `styleStates` (LoroMap of up to 4 lazily-created
 *     sub-LoroMaps keyed by StateStyleKey).
 *   - `meta`: LoroMap — specVersion, title (document-level scalars; no
 *     PatchOp addresses these individually, only replace-document touches
 *     them — a contract finding, see below).
 *   - `tokens`: LoroMap<string,string> — set-token is scalar-per-key, so a
 *     flat map matches the op grain exactly.
 *   - `params`/`data`/`lookups`/`states`/`viewports`/`namedStyles`/
 *     `components`: LoroMap keyed by each item's `.name`, value = a
 *     stableStringify'd JSON blob of the WHOLE item. None of these ops are
 *     finer than "replace the whole named item" (set-param, set-named-style,
 *     ...), so a JSON blob per map key matches the op grain exactly while
 *     still giving concurrent edits to DIFFERENT names real CRDT
 *     independence (only same-name concurrent edits collapse to LWW).
 *   - `matrix`: LoroList<string> of stableStringify'd {state,viewport} JSON
 *     blobs — matrix entries have no natural key and no PatchOp reaches them
 *     individually (only replace-document does), so this is a plain ordered
 *     list, cleared+repopulated wholesale on replace-document.
 *   - `annotations`: LoroMap keyed by FdnAnnotation.id (same JSON-blob-per-key
 *     shape as params/lookups/states/namedStyles/components — the three
 *     annotation PatchOps are whole-item or single-scalar-field writes, same
 *     grain). Concurrent annotations from different authors merge for free
 *     (different keys); concurrent status writes to the SAME annotation
 *     collapse to Loro's last-writer-wins on that map entry, same as any
 *     other same-key concurrent write in this file.
 *
 * Contract findings (see final report for the full list):
 *   - (RESOLVED 2026-07-31, contract amendment) SemanticOp gained
 *     set-style-ref/set-when variants and a 'meta' section-changed section
 *     for title/specVersion — diff() now emits all of these (model.ts).
 *   - (RESOLVED 2026-07-31, contract amendment) loadChain(bytes, opts?)
 *     now takes an optional `{actor?: string}`, matching createChain. When
 *     omitted, each create/load gets a fresh random writer identity. Explicit
 *     actors must be unique per concurrently writable replica.
 *   - (Wave 3, contract amendment) SPEC 13a-i mints a document id at
 *     creation and wants it "carried ... in the chain's metadata". types.ts
 *     (FdnDocument) has no field for it and is off-limits, so it does NOT
 *     round-trip through FdnDocument/PatchOp at all — it lives ONLY in the
 *     chain's own `meta` LoroMap (a plain scalar, exactly like specVersion/
 *     title already are), set ONCE at creation via a new optional
 *     `createChain(doc, meta, { docId })` field (additive, mirrors the
 *     existing `actor` precedent above) and read via the new `docId()`
 *     accessor. Folding the `meta.set('docId', …)` into the SAME mutation
 *     batch as the initial `replace-document` apply (see `LoroChain.create`)
 *     means it rides along on that one commit's explicit `loro.commit()` —
 *     no separate envelope, no risk of an anonymous/unmessaged Loro Change
 *     from a later implicit flush (export/checkout auto-commit pending ops
 *     with whatever message was last explicitly set, or none). There is
 *     deliberately no `setDocId()` — every caller that needs one sets it at
 *     creation time (see packages/cli commands/{new,chain}.ts). The CLI
 *     stamps the same id into the `.fdn.html` text as `data-fdn-doc-id` on
 *     `<fdn-doc>` by a small string-level insert (packages/cli/src/docid.ts)
 *     — NOT through projectDocument — since parse/project's Wave-1-fixed
 *     signatures have no channel to carry it.
 *   - (Wave 3, contract amendment) `changes()` and `importUpdate()` added
 *     for the blob-exchange wire format (SPEC 13a-iv, API.md "chain
 *     exchange"): `changes()` exposes the same per-Loro-Change envelope +
 *     raw update-bytes pairing that `log()`/`save()` already compute
 *     internally (log() now just maps over it), and `importUpdate()` is
 *     retains a single change's exact received bytes before native re-encoding
 *     and applies it through `loro.import(...); rebuildIndex()` (as produced by
 *     `changes()` on the sending side) instead of a whole other chain's
 *     full update export.
 */

import { LoroDoc, LoroMap } from 'loro-crdt'
import type { Change, LoroList, LoroTree, LoroTreeNode, PeerID, TreeID } from 'loro-crdt'
import type {
  AnchorRef,
  ChangeMeta,
  ChainActivityOptions,
  ChainActivityPage,
  ChainLogOptions,
  ChainLogPage,
  EnvelopeRecord,
  FdnAnnotation,
  FdnComponent,
  FdnDataSet,
  FdnDocument,
  FdnTokenCollection,
  FdnComponentSet,
  FdnLookup,
  FdnNamedStyle,
  FdnNode,
  FdnParam,
  FdnState,
  FdnViewport,
  NodeId,
  PatchOp,
  SemanticOp,
  StateStyleKey,
} from '../types.js'
import { computeEnvelopeHash, decodeEnvelope, encodeEnvelope, parseWallTime, type PackedEnvelope } from './envelope.js'
import { structuralDiff } from './model.js'
import { applyPatch, diffNodes } from '../patch/index.js'
import { comparePeerIds, derivePeerId, DeterministicClock, stableStringify } from './util.js'
import { ChainActivity } from './activity.js'
import { createHash, randomUUID } from 'node:crypto'

const STATE_KEYS: StateStyleKey[] = ['hover', 'focus', 'active', 'disabled']
const compareChanges = (a: Change, b: Change): number => a.lamport - b.lamport || comparePeerIds(a.peer, b.peer) || a.counter - b.counter

type KeyedSection = 'componentSets' | 'tokenCollections' | 'params' | 'data' | 'lookups' | 'states' | 'viewports' | 'namedStyles' | 'components'

type Frontier = { peer: PeerID; counter: number }[]

/** Fixed public interface (API.md) — no Loro types appear anywhere here.
 *  docId()/changes()/importUpdate() are Wave 3 additions (see module doc's
 *  "contract amendment" notes) — not part of the API.md wave-1 signature
 *  list, additive only, needed by the blob-exchange functions in
 *  exchange.ts. */
export interface FdnChain {
  doc(): FdnDocument
  versionRef(): string
  docAt(ref: string): FdnDocument
  historyRoot(): string | null
  apply(meta: ChangeMeta, ops: PatchOp[]): EnvelopeRecord
  anchor(name: string, meta?: ChangeMeta): AnchorRef
  checkout(ref: AnchorRef): FdnDocument
  diff(a: AnchorRef, b: AnchorRef): SemanticOp[]
  undo(meta: ChangeMeta): EnvelopeRecord
  head(): EnvelopeRecord
  log(): EnvelopeRecord[]
  logPage(opts?: ChainLogOptions): ChainLogPage
  activityPage(opts?: ChainActivityOptions): ChainActivityPage
  fork(actor: string): FdnChain
  merge(other: FdnChain): void
  storageFormat(): 1 | 2
  upgradeStorage(): void
  save(opts?: { format?: 1 | 2 }): Uint8Array
  verify(): { ok: boolean; brokenAt?: string }
  /** Wave 3 (SPEC 13a-i): the document id, or null if this chain predates/
   *  never received one. Immutable once set — see createChain's `docId` opt. */
  docId(): string | null
  /** Wave 3 (SPEC 13a-iv): one entry per Loro Change (== one apply() batch),
   *  oldest first, pairing each envelope with the exact update bytes that
   *  reproduce it — the unit exportBlobs() writes one-per-file. */
  changes(): { envelope: EnvelopeRecord; bytes: Uint8Array }[]
  /** Wave 3 (SPEC 13a-iv): import one change's raw update bytes (as found in
   *  a `changes()` entry / a `.fdnc` blob) into this chain. Like merge(), but
   *  for a single change instead of another chain's whole update export. */
  importUpdate(bytes: Uint8Array): void
  /** Wave 3 (exchange.ts overlap heuristic): materializes the document you'd
   *  get by importing exactly the given list of raw update-bytes spans (each
   *  as produced by `changes()` / a decoded `.fdnc` blob), in order, into a
   *  fresh empty chain — a pure function of the bytes, unrelated to this
   *  chain's own current state. Used to reconstruct a true common ancestor
   *  (pass a prefix of `changes()`) or "what the other side alone claims"
   *  (ancestor prefix + only their incoming changes, excluding any of our
   *  own unshared local edits) without needing a checkout()-able named
   *  anchor at that exact point. */
  docFromUpdates(updates: Uint8Array[]): FdnDocument
}

export interface VerifiedStorageCache { has(seal: string): boolean; add(seal: string): void }
const verifiedStorage = new Set<string>()
function rememberVerifiedStorage(seal: string): void {
  verifiedStorage.add(seal)
  if (verifiedStorage.size > 1024) verifiedStorage.delete(verifiedStorage.values().next().value!)
}

export function createChain(doc: FdnDocument, meta: ChangeMeta, opts?: { actor?: string; docId?: string }): FdnChain {
  return LoroChain.create(doc, meta, opts?.actor ?? randomUUID(), opts?.docId)
}

export function prepareChain(doc: FdnDocument, opts: { actor: string; docId: string }): (meta: ChangeMeta) => FdnChain {
  return LoroChain.prepare(doc, opts.actor, opts.docId)
}

export function loadChain(bytes: Uint8Array, opts?: { actor?: string; storageCache?: VerifiedStorageCache }): FdnChain {
  return LoroChain.load(bytes, opts?.actor, opts?.storageCache)
}

/** Bootstrap retained history without inventing a local genesis or re-exporting its bytes. */
export function chainFromUpdates(updates: Uint8Array[]): FdnChain {
  return LoroChain.fromUpdates(updates)
}

class LoroChain implements FdnChain {
  private loro: LoroDoc
  private tree: LoroTree
  private meta: LoroMap
  private tokens: LoroMap
  private tokenCollections: LoroMap
  private componentSets: LoroMap
  private params: LoroMap
  private data: LoroMap
  private lookups: LoroMap
  private states: LoroMap
  private viewports: LoroMap
  private matrix: LoroList
  private namedStyles: LoroMap
  private components: LoroMap
  /** Wave "annotations first-class citizen" (SPEC D2/D4/13a, types.ts's
   *  FdnAnnotation): LoroMap keyed by annotation `.id`, one stableStringify'd
   *  JSON blob per key — same "whole-item replace matches the op grain"
   *  reasoning as params/lookups/states/namedStyles/components above. The
   *  three PatchOps (annotate/set-annotation-status/remove-annotation) are
   *  all either whole-item or single-scalar-field writes, so a flat keyed
   *  map (not a nested per-field container) is the right grain here too. */
  private annotations: LoroMap
  private order: LoroMap

  private format: 1 | 2 = 1
  private originals = new OriginalUpdates()
  private activity: ChainActivity | undefined
  private rootFrontiers: Frontier = []
  private rootChange: Change | undefined
  private rootHash: string | undefined
  private clock = new DeterministicClock()
  private idToTree = new Map<NodeId, TreeID>()
  private materializedNodes = new Map<TreeID, FdnNode>()
  private peerId: PeerID
  private peerIdStr: PeerID
  private anchors = new Map<string, Frontier>()
  private lastLocalChange: PatchOp[] | undefined

  constructor(actor: string, loro?: LoroDoc) {
    this.peerId = derivePeerId(actor)
    this.peerIdStr = String(this.peerId) as PeerID
    this.loro = loro ?? new LoroDoc()
    this.loro.setPeerId(this.peerId)
    // Loro auto-merges same-peer changes whose commit timestamps are within
    // `mergeInterval` seconds of each other (default 1000s) into one oplog
    // Change. Our DeterministicClock increments by 1 per commit, so without
    // this the whole chain would silently collapse into a single Change —
    // disable it so "one apply() = one Loro commit" actually holds.
    this.loro.setChangeMergeInterval(0)
    this.tree = this.loro.getTree('tree')
    this.meta = this.loro.getMap('meta')
    this.tokens = this.loro.getMap('tokens')
    this.tokenCollections = this.loro.getMap('tokenCollections')
    this.componentSets = this.loro.getMap('componentSets')
    this.params = this.loro.getMap('params')
    this.data = this.loro.getMap('data')
    this.lookups = this.loro.getMap('lookups')
    this.states = this.loro.getMap('states')
    this.viewports = this.loro.getMap('viewports')
    this.matrix = this.loro.getList('matrix')
    this.namedStyles = this.loro.getMap('namedStyles')
    this.components = this.loro.getMap('components')
    this.annotations = this.loro.getMap('annotations')
    this.order = this.loro.getMap('order')
  }

  static create(doc: FdnDocument, meta: ChangeMeta, actor: string, docId?: string): LoroChain {
    const chain = new LoroChain(actor)
    // Set BEFORE apply() so it rides along inside that call's own explicit
    // commit (see module doc's Wave 3 contract-amendment note) instead of
    // sitting as a separate, unmessaged pending mutation.
    if (docId !== undefined) chain.meta.set('docId', docId)
    chain.apply(meta, [{ op: 'replace-document', doc }])
    return chain
  }

  static prepare(doc: FdnDocument, actor: string, docId: string): (meta: ChangeMeta) => LoroChain {
    const chain = new LoroChain(actor)
    chain.meta.set('docId', docId)
    const record = chain.prepareApply([{ op: 'replace-document', doc }])
    chain.materialize()
    let pending = true
    return meta => {
      if (!pending) throw new Error('prepared chain was already started')
      const wallTime = parseWallTime(meta.wallTime)
      if (meta.wallTime !== undefined && wallTime === undefined) throw new Error('wallTime must be an ISO UTC timestamp')
      pending = false
      record({ ...meta, wallTime })
      return chain
    }
  }

  static fromUpdates(updates: Uint8Array[]): LoroChain {
    const chain = new LoroChain(randomUUID())
    for (const update of updates) chain.importUpdate(update)
    assertFormatVersion({ specVersion: String(chain.meta.get('specVersion') ?? '') })
    return chain
  }

  static load(bytes: Uint8Array, actor?: string, cache?: VerifiedStorageCache): LoroChain {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const anchorsLen = view.getUint32(0, true)
    const anchorsBytes = bytes.subarray(4, 4 + anchorsLen)
    const snapshotBytes = bytes.subarray(4 + anchorsLen)
    const header = JSON.parse(new TextDecoder().decode(anchorsBytes)) as unknown
    const legacy = Array.isArray(header)
    if (!legacy && (header === null || typeof header !== 'object' || !('version' in header) || header.version !== 2 || !('anchors' in header) || !Array.isArray(header.anchors) || !('updates' in header))) throw new Error('unsupported chain storage version')
    const stored = header as unknown as { anchors: [string, Frontier][]; updates: unknown; seal: string }
    if (!legacy) {
      const seal = createHash('sha256').update(JSON.stringify({ version: 2, anchors: stored.anchors, updates: stored.updates })).update(snapshotBytes).digest('hex')
      if (stored.seal !== seal) throw new Error('chain storage integrity check failed')
    }
    const entries = (legacy ? header : stored.anchors) as [string, Frontier][]
    const loro = LoroDoc.fromSnapshot(snapshotBytes)
    // Loading a snapshot opens an independent writer, never reuses its peer identity.
    const resolvedActor = actor ?? randomUUID()
    const chain = new LoroChain(resolvedActor, loro)
    chain.rebuildIndex()
    assertFormatVersion({ specVersion: String(chain.meta.get('specVersion') ?? '') })
    for (const [name, frontier] of entries) chain.anchors.set(name, frontier)
    if (legacy) chain.captureOriginals()
    else {
      chain.format = 2
      chain.originals.load(stored.updates, chain.sortedChanges())
      if (!verifiedStorage.has(stored.seal) && !cache?.has(stored.seal)) {
        if (!chain.verify().ok) throw new Error('chain history verification failed: original update archive does not match snapshot history')
        cache?.add(stored.seal)
      }
      rememberVerifiedStorage(stored.seal)
    }
    return chain
  }

  // ——— public interface ———

  doc(): FdnDocument {
    return structuredClone(this.materialize())
  }

  versionRef(): string {
    const frontier = this.loro.frontiers().sort((a, b) => comparePeerIds(a.peer, b.peer) || a.counter - b.counter)
    return Buffer.from(JSON.stringify(frontier)).toString('base64url')
  }

  docAt(ref: string): FdnDocument {
    const decoded: unknown = JSON.parse(Buffer.from(ref, 'base64url').toString('utf8'))
    if (!Array.isArray(decoded)) throw new Error('invalid document version')
    const frontier: Frontier = decoded.map((item: unknown) => {
      if (item === null || typeof item !== 'object' || !('peer' in item) || typeof item.peer !== 'string' || !/^\d+$/.test(item.peer) || !('counter' in item) || typeof item.counter !== 'number' || !Number.isSafeInteger(item.counter) || item.counter < 0) throw new Error('invalid document version')
      return { peer: item.peer as PeerID, counter: item.counter }
    })
    const known = this.loro.oplogVersion()
    if (frontier.some(id => (known.get(id.peer) ?? 0) <= id.counter)) throw new Error('document version is missing from this chain')
    try {
      this.loro.checkout(frontier)
      this.materializedNodes.clear()
      return this.doc()
    } finally {
      this.loro.checkoutToLatest()
      this.materializedNodes.clear()
    }
  }

  historyRoot(): string | null {
    if (this.loro.getPendingTxnLength()) {
      const first = this.sortedChanges()[0]
      return first ? this.envelopeFor(first).hash : null
    }
    const target = this.loro.oplogFrontiers()
    let delta = this.rootChange ? this.loro.findIdSpansBetween(this.rootFrontiers, target) : undefined
    if (delta?.retreat.length) {
      this.rootChange = undefined
      this.rootHash = undefined
      delta = undefined
    }
    if (!delta) {
      const peers = this.loro.oplogVersion().length()
      if (peers > 1 && peers * 2 >= this.loro.changeCount()) {
        for (const changes of this.loro.getAllChanges().values()) {
          for (const change of changes) {
            if (!this.rootChange || compareChanges(change, this.rootChange) < 0) this.rootChange = change
          }
        }
        delta = { forward: [], retreat: [] }
      } else delta = this.loro.findIdSpansBetween([], target)
    }
    for (const span of delta.forward) {
      const change = this.loro.getChangeAt({ peer: span.peer, counter: span.counter })
      if (!this.rootChange || compareChanges(change, this.rootChange) < 0 || (compareChanges(change, this.rootChange) === 0 && change.length !== this.rootChange.length)) {
        this.rootChange = change
        this.rootHash = undefined
      }
    }
    this.rootFrontiers = target
    if (!this.rootChange) return null
    this.rootHash ??= this.envelopeFor(this.rootChange).hash
    return this.rootHash
  }

  apply(meta: ChangeMeta, ops: PatchOp[]): EnvelopeRecord {
    if (ops.length === 0) throw new Error('apply: ops must not be empty')
    const wallTime = parseWallTime(meta.wallTime)
    if (meta.wallTime !== undefined && wallTime === undefined) throw new Error('wallTime must be an ISO UTC timestamp')
    return this.prepareApply(ops)({ ...meta, wallTime })
  }

  private prepareApply(ops: PatchOp[]): (meta: ChangeMeta) => EnvelopeRecord {
    const beforeDoc = this.materialize()
    const initializing = this.meta.get('specVersion') === undefined && ops.length === 1 && ops[0]!.op === 'replace-document'
    const patch = applyPatch(beforeDoc, ops, { validateArtboards: !initializing })
    if (!patch.ok) throw new Error(patch.error.message)
    assertFormatVersion(patch.doc)
    const beforeVV = this.loro.version()
    const startCounter = beforeVV.get(this.peerIdStr) ?? 0
    // Must read `head`/prevHash BEFORE mutating: log()/head() walk
    // getAllChanges(), which implicitly flushes any pending uncommitted ops
    // (see chain.ts module doc) — calling it after mutating but before our
    // own explicit commit() would silently steal our message.
    const prevHash = this.tryHead()?.hash ?? null
    for (const op of patch.applied) this.applyOp(op)
    if (explicitArtboards(beforeDoc) || explicitArtboards(patch.doc)) this.meta.set('artboardActivity', stableStringify({ ...artboardActivity(beforeDoc, patch.doc, patch.applied), changeKey: `${this.peerIdStr}:${startCounter}` }))
    this.lastLocalChange = patch.inverse
    return meta => this.commitEnvelope(meta, prevHash)
  }

  undo(meta: ChangeMeta): EnvelopeRecord {
    const inverseOps = this.lastLocalChange
    if (!inverseOps) throw new Error('undo: no local change to undo')
    return this.apply(meta, inverseOps)
  }

  anchor(name: string, meta?: ChangeMeta): AnchorRef {
    if (meta) {
      if (!name.trim()) throw new Error('anchor name must not be empty')
      const wallTime = parseWallTime(meta.wallTime)
      if (meta.wallTime !== undefined && wallTime === undefined) throw new Error('wallTime must be an ISO UTC timestamp')
      const prevHash = this.tryHead()?.hash ?? null
      this.meta.set('namedVersion', stableStringify({ name, targetHash: prevHash }))
      this.commitEnvelope({ ...meta, wallTime }, prevHash)
    }
    this.anchors.set(name, this.loro.frontiers())
    return name
  }

  checkout(ref: AnchorRef): FdnDocument {
    const frontier = this.anchors.get(ref)
    if (!frontier) throw new Error(`checkout: unknown anchor ${ref}`)
    // checkout() always detaches the live doc (Loro semantics), even when
    // the target frontier IS the current latest — so restoring via
    // `checkout(savedFrontiers)` would still leave the doc detached
    // (read-only). checkoutToLatest() is the only way back to a live,
    // editable doc, which is the invariant every other public method here
    // relies on (the doc is always attached before/after any call).
    this.loro.checkout(frontier)
    this.materializedNodes.clear()
    try {
      return this.doc()
    } finally {
      this.loro.checkoutToLatest()
      this.materializedNodes.clear()
    }
  }

  diff(a: AnchorRef, b: AnchorRef): SemanticOp[] {
    return structuralDiff(this.checkout(a), this.checkout(b))
  }

  head(): EnvelopeRecord {
    const h = this.tryHead()
    if (!h) throw new Error('head: chain has no changes yet')
    return h
  }

  log(): EnvelopeRecord[] {
    return this.changes().map((c) => c.envelope)
  }

  logPage(opts?: ChainLogOptions): ChainLogPage {
    this.activity ??= new ChainActivity(this.loro, () => this.docId(), change => this.bytesForSpan(change.peer, change.counter, change.length))
    return this.activity.page(opts, this.anchors)
  }

  activityPage(opts?: ChainActivityOptions): ChainActivityPage {
    this.activity ??= new ChainActivity(this.loro, () => this.docId(), change => this.bytesForSpan(change.peer, change.counter, change.length))
    return this.activity.read(opts, this.anchors)
  }

  docId(): string | null {
    return (this.meta.get('docId') as string | undefined) ?? null
  }

  changes(): { envelope: EnvelopeRecord; bytes: Uint8Array }[] {
    const out: { envelope: EnvelopeRecord; bytes: Uint8Array }[] = []
    for (const c of this.sortedChanges()) {
      const decoded = decodeEnvelope(c.message)
      const bytes = this.bytesForSpan(c.peer, c.counter, c.length)
      const hash = computeEnvelopeHash(decoded.prevHash, decoded.author, decoded.message, decoded.specVersion, bytes)
      out.push({
        envelope: { hash, prevHash: decoded.prevHash, author: decoded.author, message: decoded.message, specVersion: decoded.specVersion, wallTime: decoded.wallTime ?? null, originNode: decoded.originNode ?? null },
        bytes: bytes.slice(),
      })
    }
    return out
  }

  importUpdate(bytes: Uint8Array): void {
    this.originals.record(bytes, () => this.loro.import(bytes))
    this.rebuildIndex()
  }

  docFromUpdates(updates: Uint8Array[]): FdnDocument {
    const scratch = new LoroChain(`scratch:${this.peerIdStr}:${updates.length}`)
    for (const bytes of updates) {
      if (bytes.length > 0) scratch.importUpdate(bytes)
    }
    return scratch.doc()
  }

  fork(actor: string): FdnChain {
    const forked = new LoroChain(actor, this.loro.fork())
    this.captureOriginals()
    forked.originals.copyFrom(this.originals)
    forked.format = this.format
    forked.rebuildIndex()
    return forked
  }

  merge(other: FdnChain): void {
    if (!(other instanceof LoroChain)) throw new Error('merge: other chain is not a LoroChain instance')
    this.captureOriginals()
    other.captureOriginals()
    this.originals.copyFrom(other.originals)
    this.loro.import(other.loro.export({ mode: 'update', from: this.loro.oplogVersion() }))
    if (other.format === 2) this.upgradeStorage()
    this.rebuildIndex()
    for (const [name, frontier] of other.anchors) {
      const current = this.anchors.get(name)
      if (!current || this.compareAnchorFrontiers(current, frontier) < 0) this.anchors.set(name, frontier)
    }
  }

  private compareAnchorFrontiers(a: Frontier, b: Frontier): number {
    let causal: -1 | 0 | 1 | undefined
    try {
      causal = this.loro.cmpFrontiers(a, b)
    } catch {
      const known = (frontier: Frontier): boolean => {
        try {
          const version = this.loro.oplogVersion()
          return frontier.every(point => (version.get(point.peer) ?? 0) > point.counter)
        } catch {
          return false
        }
      }
      const leftKnown = known(a)
      const rightKnown = known(b)
      if (leftKnown !== rightKnown) return leftKnown ? 1 : -1
    }
    if (causal !== undefined) return causal
    const sort = (frontier: Frontier): Frontier => [...frontier].sort((x, y) => comparePeerIds(x.peer, y.peer) || x.counter - y.counter)
    const left = sort(a)
    const right = sort(b)
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      const order = comparePeerIds(left[i]!.peer, right[i]!.peer) || left[i]!.counter - right[i]!.counter
      if (order) return order
    }
    return left.length - right.length
  }

  storageFormat(): 1 | 2 { return this.format }
  upgradeStorage(): void { this.format = 2 }

  save(opts?: { format?: 1 | 2 }): Uint8Array {
    if (opts?.format === 1 && this.format === 2) throw new Error('chain storage v2 cannot be downgraded')
    if (opts?.format === 2) this.upgradeStorage()
    assertFormatVersion({ specVersion: String(this.meta.get('specVersion') ?? '') })
    this.captureOriginals()
    this.originals.assertCoverage(this.sortedChanges())
    const canonical = new LoroDoc()
    canonical.importBatch(this.changes().map(change => change.bytes))
    if (canonical.oplogVersion().compare(this.loro.oplogVersion()) !== 0) {
      throw new Error('canonical snapshot rebuild did not preserve the complete history')
    }
    const snapshot = canonical.export({ mode: 'snapshot' })
    const anchors = Array.from(this.anchors.entries()).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, frontier]) => [name, [...frontier].sort((a, b) => comparePeerIds(a.peer, b.peer) || a.counter - b.counter)])
    let anchorsBytes: Uint8Array
    if (this.format === 1) {
      // A v1 reader has no archive. Refuse rather than write a snapshot whose
      // re-exports would change already-recorded envelope identities.
      const legacy = LoroDoc.fromSnapshot(snapshot)
      for (const change of this.sortedChanges()) {
        const bytes = legacy.export({ mode: 'updates-in-range', spans: [{ id: { peer: change.peer, counter: change.counter }, len: change.length }] })
        if (!Buffer.from(bytes).equals(this.bytesForSpan(change.peer, change.counter, change.length))) throw new Error(`v1 snapshot cannot preserve change identities for ${change.peer}:${change.counter}:${change.length}; opt in with FOUNDATION_CHAIN_FORMAT=2 or foundation sync open`)
      }
      anchorsBytes = new TextEncoder().encode(JSON.stringify(anchors))
    } else {
      const storage = { version: 2, anchors, updates: encodeOriginalUpdates(this.originals.save(this.sortedChanges())) }
      const seal = createHash('sha256').update(JSON.stringify(storage)).update(snapshot).digest('hex')
      anchorsBytes = new TextEncoder().encode(JSON.stringify({ ...storage, seal }))
      rememberVerifiedStorage(seal)
    }
    const header = new Uint8Array(4)
    new DataView(header.buffer).setUint32(0, anchorsBytes.length, true)
    const out = new Uint8Array(4 + anchorsBytes.length + snapshot.length)
    out.set(header, 0)
    out.set(anchorsBytes, 4)
    out.set(snapshot, 4 + anchorsBytes.length)
    return out
  }

  verify(): { ok: boolean; brokenAt?: string } {
    this.captureOriginals()
    try { this.originals.validate(this.loro, this.sortedChanges()) } catch { return { ok: false, brokenAt: 'original-update-archive' } }
    const seen = new Set<string>()
    for (const c of this.sortedChanges()) {
      const decoded = decodeEnvelope(c.message)
      const bytes = this.bytesForSpan(c.peer, c.counter, c.length)
      const hash = computeEnvelopeHash(decoded.prevHash, decoded.author, decoded.message, decoded.specVersion, bytes)
      if (decoded.prevHash !== null && !seen.has(decoded.prevHash)) return { ok: false, brokenAt: hash }
      seen.add(hash)
    }
    return { ok: true }
  }

  // ——— envelope internals ———

  private tryHead(): EnvelopeRecord | null {
    if (this.loro.getPendingTxnLength()) {
      const last = this.sortedChanges().at(-1)
      return last ? this.envelopeFor(last) : null
    }
    let last: Change | undefined
    for (const point of this.loro.oplogFrontiers()) {
      const change = this.loro.getChangeAt(point)
      if (!last || compareChanges(change, last) > 0) last = change
    }
    return last ? this.envelopeFor(last) : null
  }

  private envelopeFor(change: Change): EnvelopeRecord {
    const decoded = decodeEnvelope(change.message)
    const bytes = this.bytesForSpan(change.peer, change.counter, change.length)
    const hash = computeEnvelopeHash(decoded.prevHash, decoded.author, decoded.message, decoded.specVersion, bytes)
    return { hash, prevHash: decoded.prevHash, author: decoded.author, message: decoded.message, specVersion: decoded.specVersion, wallTime: decoded.wallTime ?? null, originNode: decoded.originNode ?? null }
  }

  private commitEnvelope(meta: ChangeMeta, prevHash: string | null): EnvelopeRecord {
    const specVersion = (this.meta.get('specVersion') as string | undefined) ?? ''
    const packed: PackedEnvelope = { author: meta.author, message: meta.message, specVersion, prevHash, ...(meta.wallTime !== undefined ? { wallTime: meta.wallTime } : {}), ...(meta.originNode !== undefined ? { originNode: meta.originNode } : {}) }
    this.loro.commit({ message: encodeEnvelope(packed), timestamp: this.clock.next() })
    const endCounter = this.loro.version().get(this.peerIdStr) ?? 0
    const committed = this.loro.getChangeAt({ peer: this.peerIdStr, counter: endCounter - 1 })
    const bytes = this.bytesForSpan(committed.peer, committed.counter, committed.length)
    const hash = computeEnvelopeHash(prevHash, meta.author, meta.message, specVersion, bytes)
    return { hash, prevHash, author: meta.author, message: meta.message, specVersion, wallTime: meta.wallTime ?? null, originNode: meta.originNode ?? null }
  }

  private bytesForSpan(peer: PeerID, counter: number, len: number): Uint8Array {
    if (len <= 0) return new Uint8Array(0)
    return this.originals.bytes(this.loro, { peer, counter, length: len })
  }

  private captureOriginals(): void {
    for (const change of this.sortedChanges()) this.originals.bytes(this.loro, change)
  }

  private sortedChanges(): Change[] {
    const flat: Change[] = []
    for (const changes of this.loro.getAllChanges().values()) flat.push(...changes)
    flat.sort(compareChanges)
    return flat
  }

  // ——— mutation ———

  private applyOp(op: PatchOp): void {
    switch (op.op) {
      case 'set-attr':
      case 'set-style':
      case 'set-style-ref':
      case 'set-text':
      case 'set-when': {
        let node: LoroTreeNode | undefined = this.treeNodeOf(op.id)
        while (node) {
          this.materializedNodes.delete(node.id)
          node = node.parent()
        }
        break
      }
      default:
        this.materializedNodes.clear()
    }
    switch (op.op) {
      case 'set-declaration-order':
        this.order.set(op.section, JSON.stringify(op.names))
        break
      case 'set-spec-version':
        this.meta.set('specVersion', op.specVersion)
        break
      case 'set-title':
        if (op.title === null) this.meta.delete('title')
        else this.meta.set('title', op.title)
        break
      case 'insert-node': {
        const parentTreeId = op.parent === null ? undefined : this.treeIdOf(op.parent)
        this.createSubtree(parentTreeId, op.index, op.node)
        break
      }
      case 'remove-node': {
        this.tree.delete(this.treeIdOf(op.id))
        break
      }
      case 'move-node': {
        const treeId = this.treeIdOf(op.id)
        const parentTreeId = op.parent === null ? undefined : this.treeIdOf(op.parent)
        this.tree.move(treeId, parentTreeId, op.index)
        break
      }
      case 'set-attr': {
        const attrs = this.nodeContainer(op.id, 'attrs')
        if (op.value === null) attrs.delete(op.key)
        else attrs.set(op.key, op.value)
        break
      }
      case 'set-style': {
        const map = op.state ? this.styleStateContainer(op.id, op.state) : this.nodeContainer(op.id, 'style')
        if (op.value === null) map.delete(op.prop)
        else map.set(op.prop, op.value)
        break
      }
      case 'set-style-ref': {
        this.treeNodeOf(op.id).data.set('styleRef', op.styleRef)
        break
      }
      case 'set-text': {
        this.treeNodeOf(op.id).data.set('text', op.text)
        break
      }
      case 'set-when': {
        this.treeNodeOf(op.id).data.set('when', op.when)
        break
      }
      case 'set-component-set': {
        this.setKeyed('componentSets', this.componentSets, op.componentSet.name, op.componentSet, op.index)
        break
      }
      case 'remove-component-set': {
        this.removeKeyed('componentSets', this.componentSets, op.name)
        break
      }
      case 'set-token-collection': {
        this.setKeyed('tokenCollections', this.tokenCollections, op.collection.name, op.collection, op.index)
        break
      }
      case 'remove-token-collection': {
        this.removeKeyed('tokenCollections', this.tokenCollections, op.name)
        break
      }
      case 'set-token': {
        if (op.value === null) this.tokens.delete(op.name)
        else this.tokens.set(op.name, op.value)
        break
      }
      case 'set-named-style': {
        this.setKeyed('namedStyles', this.namedStyles, op.style.name, op.style)
        break
      }
      case 'remove-named-style': {
        this.removeKeyed('namedStyles', this.namedStyles, op.name)
        break
      }
      case 'set-component': {
        this.setKeyed('components', this.components, op.component.name, op.component, op.index)
        break
      }
      case 'remove-component': {
        this.removeKeyed('components', this.components, op.name)
        break
      }
      case 'set-param': {
        this.setKeyed('params', this.params, op.param.name, op.param, op.index)
        break
      }
      case 'set-lookup': {
        this.setKeyed('lookups', this.lookups, op.lookup.name, op.lookup, op.index)
        break
      }
      case 'set-lookup-entry': {
        const lookup = JSON.parse(this.lookups.get(op.name) as string) as FdnDocument['lookups'][number]
        if (op.value === null) delete lookup.entries[op.key]
        else lookup.entries = { ...lookup.entries, [op.key]: op.value }
        this.setKeyed('lookups', this.lookups, op.name, lookup)
        break
      }
      case 'remove-lookup': {
        this.removeKeyed('lookups', this.lookups, op.name)
        break
      }
      case 'set-state': {
        this.setKeyed('states', this.states, op.state.name, op.state, op.index)
        break
      }
      case 'remove-param': {
        this.removeKeyed('params', this.params, op.name)
        break
      }
      case 'remove-state': {
        this.removeKeyed('states', this.states, op.name)
        break
      }
      case 'set-data': {
        this.setKeyed('data', this.data, op.data.name, op.data, op.index)
        break
      }
      case 'remove-data': {
        this.removeKeyed('data', this.data, op.name)
        break
      }
      case 'set-viewport': {
        this.setKeyed('viewports', this.viewports, op.viewport.name, op.viewport, op.index)
        break
      }
      case 'remove-viewport': {
        this.removeKeyed('viewports', this.viewports, op.name)
        break
      }
      case 'set-matrix': {
        if (this.matrix.length > 0) this.matrix.delete(0, this.matrix.length)
        for (const cell of op.cells) this.matrix.push(stableStringify(cell))
        break
      }
      case 'annotate': {
        this.annotations.set(op.annotation.id, stableStringify(op.annotation))
        break
      }
      case 'set-annotation-status': {
        const existing = this.annotations.get(op.id) as string | undefined
        if (!existing) throw new Error(`chain: unknown annotation ${op.id}`)
        const annotation = JSON.parse(existing) as FdnAnnotation
        annotation.status = op.status
        this.annotations.set(op.id, stableStringify(annotation))
        break
      }
      case 'remove-annotation': {
        this.annotations.delete(op.id)
        break
      }
      case 'replace-document': {
        this.replaceDocumentContent(op.doc)
        break
      }
    }
  }

  private nodeContainer(id: NodeId, key: 'attrs' | 'style'): LoroMap {
    return this.treeNodeOf(id).data.get(key) as LoroMap
  }

  private styleStateContainer(id: NodeId, state: StateStyleKey): LoroMap {
    const parent = this.treeNodeOf(id).data.get('styleStates') as LoroMap
    const existing = parent.get(state) as LoroMap | undefined
    return existing ?? parent.setContainer(state, new LoroMap())
  }

  private treeNodeOf(id: NodeId): LoroTreeNode {
    const node = this.tree.getNodeByID(this.treeIdOf(id))
    if (!node) throw new Error(`chain: unknown node ${id}`)
    return node
  }

  private treeIdOf(id: NodeId): TreeID {
    const treeId = this.idToTree.get(id)
    if (!treeId) throw new Error(`chain: unknown node ${id}`)
    return treeId
  }

  private createSubtree(parent: TreeID | undefined, index: number, fdn: FdnNode): void {
    const node = this.tree.createNode(parent, index)
    node.data.set('id', fdn.id)
    node.data.set('tag', fdn.tag)
    node.data.set('text', fdn.text ?? null)
    node.data.set('styleRef', fdn.styleRef ?? null)
    node.data.set('when', fdn.when ?? null)
    node.data.set('each', fdn.each ?? null)
    const attrs = node.data.setContainer('attrs', new LoroMap())
    for (const [k, v] of Object.entries(fdn.attrs)) attrs.set(k, v)
    const style = node.data.setContainer('style', new LoroMap())
    for (const [k, v] of Object.entries(fdn.style)) style.set(k, v)
    const styleStates = node.data.setContainer('styleStates', new LoroMap())
    for (const state of STATE_KEYS) {
      const plane = fdn.styleStates[state]
      if (plane && Object.keys(plane).length > 0) {
        const sub = styleStates.setContainer(state, new LoroMap())
        for (const [k, v] of Object.entries(plane)) sub.set(k, v)
      }
    }
    this.idToTree.set(fdn.id, node.id)
    fdn.children.forEach((child, i) => this.createSubtree(node.id, i, child))
  }

  private replaceDocumentContent(doc: FdnDocument): void {
    const currentBody = (this.tree.roots() ?? []).map((r) => this.materializeNode(r))
    for (const op of diffNodes(currentBody, doc.body)) this.applyOp(op)

    this.meta.set('specVersion', doc.specVersion)
    this.meta.set('title', doc.title ?? null)

    this.replaceScalarMap(this.tokens, doc.tokens)
    if (doc.componentSets?.length || this.componentSets.size > 0) this.replaceKeyedMap('componentSets', this.componentSets, doc.componentSets ?? [], (item) => item.name)
    if (doc.tokenCollections?.length || this.tokenCollections.size > 0) this.replaceKeyedMap('tokenCollections', this.tokenCollections, doc.tokenCollections ?? [], (item) => item.name)
    this.replaceKeyedMap('params', this.params, doc.params, (p) => p.name)
    this.replaceKeyedMap('data', this.data, doc.data, (d) => d.name)
    this.replaceKeyedMap('lookups', this.lookups, doc.lookups, (l) => l.name)
    this.replaceKeyedMap('states', this.states, doc.states, (s) => s.name)
    this.replaceKeyedMap('viewports', this.viewports, doc.viewports, (v) => v.name)
    this.replaceKeyedMap('namedStyles', this.namedStyles, doc.namedStyles, (s) => s.name)
    this.replaceKeyedMap('components', this.components, doc.components, (c) => c.name)
    const annotationIds = new Set(doc.annotations.map((a) => a.id))
    for (const key of this.annotations.keys() as string[]) if (!annotationIds.has(key)) this.annotations.delete(key)
    for (const annotation of doc.annotations) this.annotations.set(annotation.id, stableStringify(annotation))

    if (this.matrix.length > 0) this.matrix.delete(0, this.matrix.length)
    for (const m of doc.matrix) this.matrix.push(stableStringify(m))
  }

  private replaceScalarMap(map: LoroMap, record: Record<string, string>): void {
    for (const key of map.keys() as string[]) if (!(key in record)) map.delete(key)
    for (const [key, value] of Object.entries(record)) map.set(key, value)
  }

  private replaceKeyedMap<T>(section: KeyedSection, map: LoroMap, items: T[], nameOf: (item: T) => string): void {
    const names = items.map(nameOf)
    const kept = new Set(names)
    for (const key of map.keys() as string[]) if (!kept.has(key)) map.delete(key)
    for (const item of items) map.set(nameOf(item), stableStringify(item))
    this.order.set(section, JSON.stringify(names))
  }

  private declaredOrder(section: KeyedSection): string[] | null {
    const stored = this.order.get(section) as string | undefined
    return stored === undefined ? null : (JSON.parse(stored) as string[])
  }

  private setKeyed(section: KeyedSection, map: LoroMap, key: string, item: unknown, index?: number): void {
    map.set(key, stableStringify(item))
    const order = this.declaredOrder(section)
    if (index !== undefined) {
      const next = this.keyedValues<{ name: string }>(section, map).map((entry) => entry.name).filter((name) => name !== key)
      next.splice(index, 0, key)
      this.order.set(section, JSON.stringify(next))
      return
    }
    if (order && !order.includes(key)) this.order.set(section, JSON.stringify([...order, key]))
  }

  private removeKeyed(section: KeyedSection, map: LoroMap, key: string): void {
    map.delete(key)
    const order = this.declaredOrder(section)
    if (order?.includes(key)) this.order.set(section, JSON.stringify(order.filter((name) => name !== key)))
  }

  // ——— materialization ———

  private materialize(): FdnDocument {
    const roots = this.tree.roots() ?? []
    const body = roots.map((r) => this.materializeNode(r))
    const title = this.meta.get('title') as string | null | undefined
    return {
      specVersion: (this.meta.get('specVersion') as string | undefined) ?? '',
      ...(title != null ? { title } : {}),
      tokens: this.mapToRecord(this.tokens),
      ...(this.componentSets.size > 0 ? { componentSets: this.keyedValues<FdnComponentSet>('componentSets', this.componentSets) } : {}),
      ...(this.tokenCollections.size > 0 ? { tokenCollections: this.keyedValues<FdnTokenCollection>('tokenCollections', this.tokenCollections) } : {}),
      params: this.keyedValues<FdnParam>('params', this.params),
      data: this.keyedValues<FdnDataSet>('data', this.data),
      lookups: this.keyedValues<FdnLookup>('lookups', this.lookups),
      states: this.keyedValues<FdnState>('states', this.states),
      viewports: this.keyedValues<FdnViewport>('viewports', this.viewports),
      matrix: (this.matrix.toArray() as string[]).map((s) => JSON.parse(s) as { state: string; viewport: string }),
      namedStyles: this.keyedValues<FdnNamedStyle>('namedStyles', this.namedStyles),
      components: this.keyedValues<FdnComponent>('components', this.components),
      annotations: this.annotationsById(),
      body,
    }
  }

  private materializeNode(node: LoroTreeNode): FdnNode {
    const cached = this.materializedNodes.get(node.id)
    if (cached) return cached
    const data = node.data
    const id = data.get('id') as NodeId
    const tag = data.get('tag') as string
    const attrs = this.mapToRecord(data.get('attrs') as LoroMap)
    const style = this.mapToRecord(data.get('style') as LoroMap)
    const styleStates = this.materializeStyleStates(data.get('styleStates') as LoroMap)
    const styleRef = data.get('styleRef') as string | null
    const when = data.get('when') as string | null
    const each = data.get('each') as string | null
    const text = data.get('text') as string | null
    const children = (node.children() ?? []).map((c) => this.materializeNode(c))
    const materialized: FdnNode = {
      id,
      tag,
      attrs,
      style,
      styleStates,
      ...(styleRef != null ? { styleRef } : {}),
      ...(when != null ? { when } : {}),
      ...(each != null ? { each } : {}),
      ...(text != null ? { text } : {}),
      children,
    }
    this.materializedNodes.set(node.id, materialized)
    return materialized
  }

  private materializeStyleStates(map: LoroMap): Partial<Record<StateStyleKey, Record<string, string>>> {
    const out: Partial<Record<StateStyleKey, Record<string, string>>> = {}
    for (const state of STATE_KEYS) {
      const sub = map.get(state) as LoroMap | undefined
      if (sub) out[state] = this.mapToRecord(sub)
    }
    return out
  }

  private mapToRecord(map: LoroMap): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of map.entries()) out[k] = v as string
    return out
  }

  private annotationsById(): FdnAnnotation[] {
    const items = (this.annotations.values() as string[]).map((value) => JSON.parse(value) as FdnAnnotation)
    return items.sort((a, b) => a.id.localeCompare(b.id))
  }

  private keyedValues<T>(section: KeyedSection, map: LoroMap): T[] {
    const position = new Map((this.declaredOrder(section) ?? []).map((key, index) => [key, index]))
    const entries = (map.entries() as [string, unknown][]).map(([key, value]) => ({ key, item: JSON.parse(value as string) as T }))
    entries.sort((a, b) => (position.get(a.key) ?? Infinity) - (position.get(b.key) ?? Infinity) || a.key.localeCompare(b.key))
    return entries.map((entry) => entry.item)
  }

  private rebuildIndex(): void {
    this.materializedNodes.clear()
    this.idToTree.clear()
    for (const node of this.tree.getNodes()) {
      const id = node.data.get('id') as NodeId | undefined
      if (id === undefined) continue
      this.idToTree.set(id, node.id)
    }
  }
}
