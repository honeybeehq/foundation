import type { FdnDocument, FdnNode, NodeId, PatchOp, StateStyleKey } from '../types.js'
import { indexNodes, invertOp, type NodeLocation } from '../chain/model.js'
import { stableStringify } from '../chain/util.js'

export type PatchErrorCode = 'unknown-node' | 'duplicate-id' | 'invalid-op'

export interface PatchError {
  code: PatchErrorCode
  message: string
}

export type PatchResult =
  | { ok: true; doc: FdnDocument; applied: PatchOp[]; inverse: PatchOp[] }
  | { ok: false; error: PatchError }

const STATE_KEYS: StateStyleKey[] = ['hover', 'focus', 'active', 'disabled']

class PatchFailure extends Error {
  constructor(readonly code: PatchErrorCode, message: string) {
    super(message)
  }
}

export function applyPatch(doc: FdnDocument, ops: PatchOp[], opts?: { lenient?: boolean }): PatchResult {
  const lenient = opts?.lenient ?? false
  let working = structuredClone(doc)
  const applied: PatchOp[] = []
  const inverses: PatchOp[] = []
  let fallback = false
  for (const op of ops) {
    const index = indexNodes(working.body)
    let effective: PatchOp
    try {
      effective = checkOp(op, working, index, lenient)
    } catch (err) {
      if (!(err instanceof PatchFailure)) throw err
      if (lenient) continue
      return { ok: false, error: { code: err.code, message: err.message } }
    }
    const inverse = invertOp(effective, working, index)
    if (inverse === 'fallback') fallback = true
    else if (inverse !== null) inverses.push(inverse)
    working = applyOp(working, effective, index)
    applied.push(effective)
  }
  const inverse: PatchOp[] = fallback ? [{ op: 'replace-document', doc: structuredClone(doc) }] : inverses.reverse()
  return { ok: true, doc: working, applied, inverse }
}

function requireNode(index: Map<NodeId, NodeLocation>, id: NodeId): NodeLocation {
  const loc = index.get(id)
  if (!loc) throw new PatchFailure('unknown-node', `unknown node "${id}"`)
  return loc
}

function childrenOf(doc: FdnDocument, index: Map<NodeId, NodeLocation>, parent: NodeId | null): FdnNode[] {
  return parent === null ? doc.body : requireNode(index, parent).node.children
}

function checkIndex(value: number, max: number, lenient: boolean, what: string): number {
  if (Number.isInteger(value) && value >= 0 && value <= max) return value
  if (lenient) return Math.max(0, Math.min(max, Number.isInteger(value) ? value : max))
  throw new PatchFailure('invalid-op', `${what} index ${value} is outside 0..${max}`)
}

function subtreeIds(node: FdnNode, out: NodeId[] = []): NodeId[] {
  out.push(node.id)
  for (const child of node.children) subtreeIds(child, out)
  return out
}

function isWithin(index: Map<NodeId, NodeLocation>, id: NodeId, ancestor: NodeId): boolean {
  let current: NodeId | null = id
  while (current !== null) {
    if (current === ancestor) return true
    current = index.get(current)?.parent ?? null
  }
  return false
}

function checkOp(op: PatchOp, doc: FdnDocument, index: Map<NodeId, NodeLocation>, lenient: boolean): PatchOp {
  switch (op.op) {
    case 'insert-node': {
      const siblings = childrenOf(doc, index, op.parent)
      const ids = subtreeIds(op.node)
      const seen = new Set<NodeId>()
      for (const id of ids) {
        if (id === '') throw new PatchFailure('invalid-op', 'inserted node has an empty id')
        if (index.has(id) || seen.has(id)) throw new PatchFailure('duplicate-id', `node id "${id}" already exists`)
        seen.add(id)
      }
      return { ...op, index: checkIndex(op.index, siblings.length, lenient, 'insert') }
    }
    case 'remove-node':
      requireNode(index, op.id)
      return op
    case 'move-node': {
      const loc = requireNode(index, op.id)
      if (op.parent !== null && isWithin(index, op.parent, op.id)) {
        throw new PatchFailure('invalid-op', `cannot move "${op.id}" into itself or its descendant "${op.parent}"`)
      }
      const siblings = childrenOf(doc, index, op.parent)
      const max = loc.parent === op.parent ? siblings.length - 1 : siblings.length
      return { ...op, index: checkIndex(op.index, max, lenient, 'move') }
    }
    case 'set-attr':
      requireNode(index, op.id)
      if (op.key === '') throw new PatchFailure('invalid-op', 'set-attr needs a non-empty key')
      return op
    case 'set-style':
      requireNode(index, op.id)
      if (op.prop === '') throw new PatchFailure('invalid-op', 'set-style needs a non-empty prop')
      if (op.state !== undefined && !STATE_KEYS.includes(op.state)) throw new PatchFailure('invalid-op', `unknown style state "${op.state}"`)
      return op
    case 'set-style-ref':
    case 'set-text':
    case 'set-when':
      requireNode(index, op.id)
      return op
    case 'set-token':
      if (op.name === '') throw new PatchFailure('invalid-op', 'set-token needs a non-empty name')
      return op
    case 'set-annotation-status':
      if (!doc.annotations.some((a) => a.id === op.id)) throw new PatchFailure('invalid-op', `unknown annotation "${op.id}"`)
      return op
    default:
      return op
  }
}

function upsertByName<T extends { name: string }>(items: T[], item: T): T[] {
  const rest = items.filter((existing) => existing.name !== item.name)
  return [...rest, structuredClone(item)].sort((a, b) => a.name.localeCompare(b.name))
}

function applyOp(doc: FdnDocument, op: PatchOp, index: Map<NodeId, NodeLocation>): FdnDocument {
  const node = (id: NodeId): FdnNode => (index.get(id) as NodeLocation).node
  switch (op.op) {
    case 'insert-node':
      childrenOf(doc, index, op.parent).splice(op.index, 0, structuredClone(op.node))
      return doc
    case 'remove-node': {
      const loc = index.get(op.id) as NodeLocation
      childrenOf(doc, index, loc.parent).splice(loc.index, 1)
      return doc
    }
    case 'move-node': {
      const loc = index.get(op.id) as NodeLocation
      childrenOf(doc, index, loc.parent).splice(loc.index, 1)
      childrenOf(doc, index, op.parent).splice(op.index, 0, loc.node)
      return doc
    }
    case 'set-attr': {
      const target = node(op.id)
      if (op.value === null) delete target.attrs[op.key]
      else target.attrs[op.key] = op.value
      return doc
    }
    case 'set-style': {
      const target = node(op.id)
      const plane = op.state ? (target.styleStates[op.state] ??= {}) : target.style
      if (op.value === null) delete plane[op.prop]
      else plane[op.prop] = op.value
      return doc
    }
    case 'set-style-ref': {
      const target = node(op.id)
      if (op.styleRef === null) delete target.styleRef
      else target.styleRef = op.styleRef
      return doc
    }
    case 'set-text':
      node(op.id).text = op.text
      return doc
    case 'set-when': {
      const target = node(op.id)
      if (op.when === null) delete target.when
      else target.when = op.when
      return doc
    }
    case 'set-token':
      if (op.value === null) delete doc.tokens[op.name]
      else doc.tokens[op.name] = op.value
      return doc
    case 'set-named-style':
      doc.namedStyles = upsertByName(doc.namedStyles, op.style)
      return doc
    case 'remove-named-style':
      doc.namedStyles = doc.namedStyles.filter((s) => s.name !== op.name)
      return doc
    case 'set-component':
      doc.components = upsertByName(doc.components, op.component)
      return doc
    case 'remove-component':
      doc.components = doc.components.filter((c) => c.name !== op.name)
      return doc
    case 'set-param':
      doc.params = upsertByName(doc.params, op.param)
      return doc
    case 'set-lookup':
      doc.lookups = upsertByName(doc.lookups, op.lookup)
      return doc
    case 'set-state':
      doc.states = upsertByName(doc.states, op.state)
      return doc
    case 'annotate':
      doc.annotations = [...doc.annotations.filter((a) => a.id !== op.annotation.id), structuredClone(op.annotation)].sort((a, b) => a.id.localeCompare(b.id))
      return doc
    case 'set-annotation-status':
      doc.annotations = doc.annotations.map((a) => (a.id === op.id ? { ...a, status: op.status } : a))
      return doc
    case 'remove-annotation':
      doc.annotations = doc.annotations.filter((a) => a.id !== op.id)
      return doc
    case 'replace-document':
      return structuredClone(op.doc)
  }
}

export function normalizeDocument(doc: FdnDocument): FdnDocument {
  return {
    ...doc,
    params: byName(doc.params),
    data: byName(doc.data),
    lookups: byName(doc.lookups),
    states: byName(doc.states),
    viewports: byName(doc.viewports),
    matrix: [...doc.matrix].sort((a, b) => a.state.localeCompare(b.state) || a.viewport.localeCompare(b.viewport)),
    namedStyles: byName(doc.namedStyles),
    components: byName(doc.components),
    annotations: [...doc.annotations].sort((a, b) => a.id.localeCompare(b.id)),
  }
}

function byName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name))
}

export function diffPatch(original: FdnDocument, target: FdnDocument): PatchOp[] | null {
  const from = normalizeDocument(original)
  const to = normalizeDocument(target)
  if (from.specVersion !== to.specVersion || from.title !== to.title) return null
  if (!sameJson(from.data, to.data) || !sameJson(from.viewports, to.viewports) || !sameJson(from.matrix, to.matrix)) return null
  const ops: PatchOp[] = []
  if (!diffNamed(from.params, to.params, (param) => ({ op: 'set-param', param }), null, ops)) return null
  if (!diffNamed(from.lookups, to.lookups, (lookup) => ({ op: 'set-lookup', lookup }), null, ops)) return null
  if (!diffNamed(from.states, to.states, (state) => ({ op: 'set-state', state }), null, ops)) return null
  diffNamed(from.namedStyles, to.namedStyles, (style) => ({ op: 'set-named-style', style }), (name) => ({ op: 'remove-named-style', name }), ops)
  diffNamed(from.components, to.components, (component) => ({ op: 'set-component', component }), (name) => ({ op: 'remove-component', name }), ops)
  diffRecord(from.tokens, to.tokens, (name, value) => ops.push({ op: 'set-token', name, value }))
  diffBody(from, to, ops)
  const beforeAnnotations = new Map(from.annotations.map((a) => [a.id, a]))
  const afterIds = new Set(to.annotations.map((a) => a.id))
  for (const annotation of to.annotations) {
    if (!sameJson(beforeAnnotations.get(annotation.id), annotation)) ops.push({ op: 'annotate', annotation })
  }
  for (const id of beforeAnnotations.keys()) if (!afterIds.has(id)) ops.push({ op: 'remove-annotation', id })
  return ops
}

function sameJson(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

function diffNamed<T extends { name: string }>(
  from: T[],
  to: T[],
  set: (item: T) => PatchOp,
  remove: ((name: string) => PatchOp) | null,
  ops: PatchOp[],
): boolean {
  const before = new Map(from.map((item) => [item.name, item]))
  const afterNames = new Set(to.map((item) => item.name))
  for (const name of before.keys()) {
    if (afterNames.has(name)) continue
    if (!remove) return false
    ops.push(remove(name))
  }
  for (const item of to) if (!sameJson(before.get(item.name), item)) ops.push(set(item))
  return true
}

function diffRecord(from: Record<string, string>, to: Record<string, string>, emit: (key: string, value: string | null) => void): void {
  for (const [key, value] of Object.entries(to)) if (from[key] !== value) emit(key, value)
  for (const key of Object.keys(from)) if (!(key in to)) emit(key, null)
}

function needsReplacement(a: FdnNode, b: FdnNode): boolean {
  return a.tag !== b.tag || a.each !== b.each || (a.text !== undefined && b.text === undefined)
}

function diffBody(from: FdnDocument, to: FdnDocument, ops: PatchOp[]): void {
  const before = indexNodes(from.body)
  const after = indexNodes(to.body)
  const kept = new Set<NodeId>()
  const order = new Map<NodeId | null, NodeId[]>([[null, []]])
  const parentOf = new Map<NodeId, NodeId | null>()
  const sweep = (nodes: FdnNode[], parent: NodeId | null): void => {
    const siblings = order.get(parent) as NodeId[]
    for (const node of nodes) {
      const target = after.get(node.id)
      if (!target || needsReplacement(node, target.node)) {
        ops.push({ op: 'remove-node', id: node.id })
        continue
      }
      kept.add(node.id)
      siblings.push(node.id)
      parentOf.set(node.id, parent)
      order.set(node.id, [])
      sweep(node.children, node.id)
    }
  }
  sweep(from.body, null)

  const hasKeptDescendant = (node: FdnNode): boolean => node.children.some((child) => kept.has(child.id) || hasKeptDescendant(child))
  const place = (nodes: FdnNode[], parent: NodeId | null): void => {
    const siblings = order.get(parent) as NodeId[]
    nodes.forEach((node, index) => {
      if (kept.has(node.id)) {
        const currentParent = parentOf.get(node.id) as NodeId | null
        const currentSiblings = order.get(currentParent) as NodeId[]
        const currentIndex = currentSiblings.indexOf(node.id)
        if (currentParent !== parent || currentIndex !== index) {
          ops.push({ op: 'move-node', id: node.id, parent, index })
          currentSiblings.splice(currentIndex, 1)
          siblings.splice(index, 0, node.id)
          parentOf.set(node.id, parent)
        }
        diffNode((before.get(node.id) as NodeLocation).node, node, ops)
        place(node.children, node.id)
        return
      }
      siblings.splice(index, 0, node.id)
      if (!hasKeptDescendant(node)) {
        ops.push({ op: 'insert-node', parent, index, node })
        return
      }
      ops.push({ op: 'insert-node', parent, index, node: { ...node, children: [] } })
      order.set(node.id, [])
      place(node.children, node.id)
    })
  }
  place(to.body, null)
}

function diffNode(a: FdnNode, b: FdnNode, ops: PatchOp[]): void {
  const id = b.id
  diffRecord(a.attrs, b.attrs, (key, value) => ops.push({ op: 'set-attr', id, key, value }))
  diffRecord(a.style, b.style, (prop, value) => ops.push({ op: 'set-style', id, prop, value }))
  for (const state of STATE_KEYS) {
    diffRecord(a.styleStates[state] ?? {}, b.styleStates[state] ?? {}, (prop, value) => ops.push({ op: 'set-style', id, prop, value, state }))
  }
  if (b.text !== undefined && a.text !== b.text) ops.push({ op: 'set-text', id, text: b.text })
  if ((a.styleRef ?? null) !== (b.styleRef ?? null)) ops.push({ op: 'set-style-ref', id, styleRef: b.styleRef ?? null })
  if ((a.when ?? null) !== (b.when ?? null)) ops.push({ op: 'set-when', id, when: b.when ?? null })
}
