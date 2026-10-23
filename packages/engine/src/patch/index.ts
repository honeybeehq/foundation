import { validateArtboards, assertFormatVersion } from '../artboards/index.js'
import { validateInstanceOverrides } from '../components/overrides.js'
import { isJsonValue } from '../data.js'
import { componentIssueKey, validateComponentSets } from '../components/variants.js'
import { validateTokenCollections } from '../tokens/index.js'
import type { FdnDocument, FdnNode, NodeId, PatchOp, StateStyleKey } from '../types.js'
import { indexNodes, invertOp, type NodeLocation } from '../chain/model.js'
import { stableStringify } from '../chain/util.js'
import { stateStyleLookup, validateStateStyles } from '../state-styles.js'

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

export function applyPatch(doc: FdnDocument, ops: PatchOp[], opts?: { lenient?: boolean; validateTokens?: boolean; validateComponents?: boolean; validateStateStyles?: boolean; validateArtboards?: boolean }): PatchResult {
  const lenient = opts?.lenient ?? false
  let working = structuredClone(doc)
  const applied: PatchOp[] = []
  const inverses: PatchOp[] = []
  let fallback = false
  let index = indexNodes(working.body)
  for (const op of ops) {
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
    if (!['set-attr', 'set-style', 'set-style-ref', 'set-text', 'set-when'].includes(effective.op)) index = indexNodes(working.body)
    applied.push(effective)
  }
  if (opts?.validateTokens !== false) {
    const issue = validateTokenCollections(working)[0]
    if (issue) return { ok: false, error: { code: 'invalid-op', message: issue.message } }
  }
  if (opts?.validateComponents !== false) {
    const prior = new Set([...validateComponentSets(doc), ...validateInstanceOverrides(doc).filter((item) => item.severity === 'error')].map(componentIssueKey))
    const issue = [...validateComponentSets(working), ...validateInstanceOverrides(working).filter((item) => item.severity === 'error')].find((item) => !prior.has(componentIssueKey(item)))
    if (issue) return { ok: false, error: { code: 'invalid-op', message: issue.message } }
  }
  if (opts?.validateStateStyles !== false) {
    const issues = validateStateStyles(working)
    if (issues.length) {
      const prior = new Set(validateStateStyles(doc).map(issue => stableStringify(issue)))
      const issue = issues.find(issue => !prior.has(stableStringify(issue)))
      if (issue) return { ok: false, error: { code: 'invalid-op', message: issue.message } }
    }
  }
  if (opts?.validateArtboards !== false) {
    try { assertFormatVersion(working) } catch (err) { return { ok: false, error: { code: 'invalid-op', message: String(err) } } }
    const key = (issue: { code: string; nodeId?: string }) => `${issue.code}:${issue.nodeId ?? ''}`
    const prior = new Set(validateArtboards(doc).map(key))
    const issue = validateArtboards(working).find(issue => !prior.has(key(issue)))
    if (issue) return { ok: false, error: { code: 'invalid-op', message: issue.message } }
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
    case 'set-declaration-order': {
      const names = (doc[op.section] ?? []).map(item => item.name)
      if (new Set(op.names).size !== op.names.length || op.names.some(name => !names.includes(name))) throw new PatchFailure('invalid-op', 'declaration order needs unique existing names')
      return { ...op, names: [...op.names, ...names.filter(name => !op.names.includes(name))] }
    }
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
    case 'set-style': {
      const node = requireNode(index, op.id).node
      if (op.prop === '') throw new PatchFailure('invalid-op', 'set-style needs a non-empty prop')
      if (op.state !== undefined && !STATE_KEYS.includes(op.state)) throw new PatchFailure('invalid-op', `unknown style state "${op.state}"`)
      const named = node.styleRef ? doc.namedStyles.find(style => style.name === node.styleRef) : undefined
      const own = (op.state ? node.styleStates[op.state] : node.style)?.[op.prop]
      const value = own ?? (op.state ? named?.styleStates[op.state] : named?.style)?.[op.prop]
      if (op.value !== value && (op.value !== null || own !== undefined) && stateStyleLookup(value) && op.replaceBinding !== true) throw new PatchFailure('invalid-op', `"${op.prop}" has a state binding; edit its lookup entry or explicitly replaceBinding`)
      return op
    }
    case 'set-style-ref':
    case 'set-text':
    case 'set-when':
      requireNode(index, op.id)
      return op
    case 'set-token':
      if (op.name === '') throw new PatchFailure('invalid-op', 'set-token needs a non-empty name')
      return op
    case 'set-lookup-entry':
      if (!doc.lookups.some(table => table.name === op.name)) throw new PatchFailure('invalid-op', `lookup "${op.name}" is not declared`)
      return op
    case 'set-component-set': {
      const items = doc.componentSets ?? []
      if (!op.componentSet.name) throw new PatchFailure('invalid-op', 'component set needs a name')
      return op.index === undefined ? op : { ...op, index: checkIndex(op.index, items.filter((item) => item.name !== op.componentSet.name).length, lenient, op.op) }
    }
    case 'set-token-collection': {
      const items = doc.tokenCollections ?? []
      if (!op.collection.name) throw new PatchFailure('invalid-op', 'set-token-collection needs a name')
      if (op.index === undefined) return op
      return { ...op, index: checkIndex(op.index, items.filter((item) => item.name !== op.collection.name).length, lenient, op.op) }
    }
    case 'set-param': {
      const items = doc.params
      if (!op.param.name) throw new PatchFailure('invalid-op', 'param needs a non-empty name')
      return op.index === undefined ? op : { ...op, index: checkIndex(op.index, items.filter((item) => item.name !== op.param.name).length, lenient, op.op) }
    }
    case 'remove-param':
      if (!op.name) throw new PatchFailure('invalid-op', 'param needs a non-empty name')
      return op
    case 'set-state': {
      const items = doc.states
      if (!op.state.name) throw new PatchFailure('invalid-op', 'state needs a non-empty name')
      return op.index === undefined ? op : { ...op, index: checkIndex(op.index, items.filter((item) => item.name !== op.state.name).length, lenient, op.op) }
    }
    case 'remove-state':
      if (!op.name) throw new PatchFailure('invalid-op', 'state needs a non-empty name')
      return op
    case 'set-data': {
      const items = doc.data
      if (!op.data.name) throw new PatchFailure('invalid-op', 'data needs a non-empty name')
      if (!op.data.items.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item)) || !isJsonValue(op.data.items)) throw new PatchFailure('invalid-op', 'data items must contain finite JSON values')
      return op.index === undefined ? op : { ...op, index: checkIndex(op.index, items.filter((item) => item.name !== op.data.name).length, lenient, op.op) }
    }
    case 'remove-data':
      if (!op.name) throw new PatchFailure('invalid-op', 'data needs a non-empty name')
      return op
    case 'set-viewport': {
      const items = doc.viewports
      if (!op.viewport.name) throw new PatchFailure('invalid-op', 'viewport needs a non-empty name')
      if (![op.viewport.width, op.viewport.height].every((value) => Number.isFinite(value) && value > 0)) throw new PatchFailure('invalid-op', 'viewport dimensions must be finite and positive')
      return op.index === undefined ? op : { ...op, index: checkIndex(op.index, items.filter((item) => item.name !== op.viewport.name).length, lenient, op.op) }
    }
    case 'remove-viewport':
      if (!op.name) throw new PatchFailure('invalid-op', 'viewport needs a non-empty name')
      return op
    case 'set-lookup':
    case 'set-component': {
      if (op.op === 'set-lookup' && op.createOnly === true && doc.lookups.some(table => table.name === op.lookup.name)) throw new PatchFailure('invalid-op', `lookup "${op.lookup.name}" already exists; choose another name or edit the bound table`)
      const items = op.op === 'set-lookup' ? doc.lookups : doc.components
      const name = op.op === 'set-lookup' ? op.lookup.name : op.component.name
      if (name === '') throw new PatchFailure('invalid-op', `${op.op} needs a non-empty name`)
      if (op.index === undefined) return op
      return { ...op, index: checkIndex(op.index, items.filter((item) => item.name !== name).length, lenient, op.op) }
    }
    case 'remove-component-set':
    case 'remove-lookup':
      if (op.name === '') throw new PatchFailure('invalid-op', `${op.op} needs a non-empty name`)
      return op
    case 'set-annotation-status':
      if (!doc.annotations.some((a) => a.id === op.id)) throw new PatchFailure('invalid-op', `unknown annotation "${op.id}"`)
      return op
    default:
      return op
  }
}

function upsertByName<T extends { name: string }>(items: T[], item: T, index?: number): T[] {
  const copy = structuredClone(item)
  if (index !== undefined) {
    const next = items.filter((existing) => existing.name !== item.name)
    next.splice(index, 0, copy)
    return next
  }
  return items.some((existing) => existing.name === item.name) ? items.map((existing) => (existing.name === item.name ? copy : existing)) : [...items, copy]
}

function applyOp(doc: FdnDocument, op: PatchOp, index: Map<NodeId, NodeLocation>): FdnDocument {
  const node = (id: NodeId): FdnNode => (index.get(id) as NodeLocation).node
  switch (op.op) {
    case 'set-declaration-order': {
      const rank = new Map(op.names.map((name, index) => [name, index]))
      doc[op.section]?.sort((a, b) => rank.get(a.name)! - rank.get(b.name)!)
      return doc
    }
    case 'set-spec-version':
      doc.specVersion = op.specVersion
      return doc
    case 'set-title':
      if (op.title === null) delete doc.title
      else doc.title = op.title
      return doc
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
    case 'set-component-set':
      doc.componentSets = upsertByName(doc.componentSets ?? [], op.componentSet, op.index)
      return doc
    case 'remove-component-set':
      doc.componentSets = (doc.componentSets ?? []).filter((item) => item.name !== op.name)
      if (doc.componentSets.length === 0) delete doc.componentSets
      return doc
    case 'set-token-collection':
      doc.tokenCollections = upsertByName(doc.tokenCollections ?? [], op.collection, op.index)
      return doc
    case 'remove-token-collection': {
      const next = (doc.tokenCollections ?? []).filter((item) => item.name !== op.name)
      if (next.length) doc.tokenCollections = next
      else delete doc.tokenCollections
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
      doc.components = upsertByName(doc.components, op.component, op.index)
      return doc
    case 'remove-component':
      doc.components = doc.components.filter((c) => c.name !== op.name)
      return doc
    case 'set-param':
      doc.params = upsertByName(doc.params, op.param, op.index)
      return doc
    case 'set-lookup':
      doc.lookups = upsertByName(doc.lookups, op.lookup, op.index)
      return doc
    case 'set-lookup-entry': {
      const table = doc.lookups.find(table => table.name === op.name)!
      if (op.value === null) delete table.entries[op.key]
      else table.entries = { ...table.entries, [op.key]: op.value }
      return doc
    }
    case 'remove-lookup':
      doc.lookups = doc.lookups.filter((lookup) => lookup.name !== op.name)
      return doc
    case 'set-state':
      doc.states = upsertByName(doc.states, op.state, op.index)
      return doc
    case 'remove-param':
      doc.params = doc.params.filter((item) => item.name !== op.name)
      return doc
    case 'remove-state':
      doc.states = doc.states.filter((item) => item.name !== op.name)
      return doc
    case 'set-data':
      doc.data = upsertByName(doc.data, op.data, op.index)
      return doc
    case 'remove-data':
      doc.data = doc.data.filter((item) => item.name !== op.name)
      return doc
    case 'set-viewport':
      doc.viewports = upsertByName(doc.viewports, op.viewport, op.index)
      return doc
    case 'remove-viewport':
      doc.viewports = doc.viewports.filter((item) => item.name !== op.name)
      return doc
    case 'set-matrix':
      doc.matrix = structuredClone(op.cells)
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
  return { ...doc, annotations: [...doc.annotations].sort((a, b) => a.id.localeCompare(b.id)) }
}

export function diffPatch(original: FdnDocument, target: FdnDocument): PatchOp[] | null {
  const from = normalizeDocument(original)
  const to = normalizeDocument(target)
  try { assertFormatVersion(to) } catch { return null }
  const ops: PatchOp[] = []
  if (from.specVersion !== to.specVersion) ops.push({ op: 'set-spec-version', specVersion: to.specVersion })
  if (from.title !== to.title) ops.push({ op: 'set-title', title: to.title ?? null })
  if (!diffNamed('params', from.params, to.params, (param) => ({ op: 'set-param', param }), (name) => ({ op: 'remove-param', name }), ops)) return null
  if (!diffNamed('lookups', from.lookups, to.lookups, (lookup) => ({ op: 'set-lookup', lookup }), (name) => ({ op: 'remove-lookup', name }), ops)) return null
  for (const [position, op] of [...ops.entries()].reverse()) if (op.op === 'set-lookup') {
    const previous = from.lookups.find(table => table.name === op.lookup.name)
    if (previous) {
      const entries: PatchOp[] = []
      diffRecord(previous.entries, op.lookup.entries, (key, value) => entries.push({ op: 'set-lookup-entry', name: op.lookup.name, key, value }))
      ops.splice(position, 1, ...entries)
    }
  }
  if (!diffNamed('states', from.states, to.states, (state) => ({ op: 'set-state', state }), (name) => ({ op: 'remove-state', name }), ops)) return null
  if (!diffNamed('namedStyles', from.namedStyles, to.namedStyles, (style) => ({ op: 'set-named-style', style }), (name) => ({ op: 'remove-named-style', name }), ops)) return null
  if (!diffNamed('components', from.components, to.components, (component) => ({ op: 'set-component', component }), (name) => ({ op: 'remove-component', name }), ops)) return null
  if (!diffNamed('tokenCollections', from.tokenCollections ?? [], to.tokenCollections ?? [], (collection) => ({ op: 'set-token-collection', collection }), (name) => ({ op: 'remove-token-collection', name }), ops)) return null
  if (!diffNamed('data', from.data, to.data, (data) => ({ op: 'set-data', data }), (name) => ({ op: 'remove-data', name }), ops)) return null
  if (!diffNamed('viewports', from.viewports, to.viewports, (viewport) => ({ op: 'set-viewport', viewport }), (name) => ({ op: 'remove-viewport', name }), ops)) return null
  if (!sameJson(from.matrix, to.matrix)) ops.push({ op: 'set-matrix', cells: to.matrix })
  if (!diffNamed('componentSets', from.componentSets ?? [], to.componentSets ?? [], (componentSet) => ({ op: 'set-component-set', componentSet }), (name) => ({ op: 'remove-component-set', name }), ops)) return null
  diffRecord(from.tokens, to.tokens, (name, value) => ops.push({ op: 'set-token', name, value }))
  ops.push(...diffNodes(from.body, to.body, [...from.namedStyles, ...to.namedStyles]))
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
  section: Extract<PatchOp, { op: 'set-declaration-order' }>['section'],
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
  if (from.map(item => item.name).join('\u0000') !== to.map(item => item.name).join('\u0000')) ops.push({ op: 'set-declaration-order', section, names: to.map(item => item.name) })
  return true
}

function diffRecord(from: Record<string, string>, to: Record<string, string>, emit: (key: string, value: string | null) => void): void {
  for (const [key, value] of Object.entries(to)) if (from[key] !== value) emit(key, value)
  for (const key of Object.keys(from)) if (!Object.hasOwn(to, key)) emit(key, null)
}

function needsReplacement(a: FdnNode, b: FdnNode): boolean {
  return a.tag !== b.tag || a.each !== b.each || (a.text !== undefined && b.text === undefined)
}

export function diffNodes(from: FdnNode[], to: FdnNode[], styles: FdnDocument['namedStyles'] = []): PatchOp[] {
  const ops: PatchOp[] = []
  const before = indexNodes(from)
  const after = indexNodes(to)
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
  sweep(from, null)

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
        diffNode((before.get(node.id) as NodeLocation).node, node, ops, styles)
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
  place(to, null)
  return ops
}

function diffNode(a: FdnNode, b: FdnNode, ops: PatchOp[], styles: FdnDocument['namedStyles']): void {
  const id = b.id
  const replacesBinding = (prop: string, state?: StateStyleKey): boolean => Boolean(stateStyleLookup((state ? a.styleStates[state] : a.style)?.[prop]) || styles.some(style => (style.name === a.styleRef || style.name === b.styleRef) && stateStyleLookup((state ? style.styleStates[state] : style.style)?.[prop])))
  diffRecord(a.attrs, b.attrs, (key, value) => ops.push({ op: 'set-attr', id, key, value }))
  diffRecord(a.style, b.style, (prop, value) => ops.push({ op: 'set-style', id, prop, value, ...(replacesBinding(prop) ? { replaceBinding: true } : {}) }))
  for (const state of STATE_KEYS) {
    diffRecord(a.styleStates[state] ?? {}, b.styleStates[state] ?? {}, (prop, value) => ops.push({ op: 'set-style', id, prop, value, state, ...(replacesBinding(prop, state) ? { replaceBinding: true } : {}) }))
  }
  if (b.text !== undefined && a.text !== b.text) ops.push({ op: 'set-text', id, text: b.text })
  if ((a.styleRef ?? null) !== (b.styleRef ?? null)) ops.push({ op: 'set-style-ref', id, styleRef: b.styleRef ?? null })
  if ((a.when ?? null) !== (b.when ?? null)) ops.push({ op: 'set-when', id, when: b.when ?? null })
}
