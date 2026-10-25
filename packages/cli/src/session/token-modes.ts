import { ARTBOARD_FRAME_VERSION, expandArtboardOp, promoteArtboardFrame } from 'foundation-engine'
import type { ArtboardOp } from 'foundation-engine'
import { applyPatch, indexNodes } from 'foundation-engine'
import type { FdnDocument, FdnNode, InstanceDetachReport, InstanceSwapReport, PatchOp } from 'foundation-engine'
import { expandComponentOp } from './components.js'
import type { ComponentOp, PlacementOp, SessionOp, TokenModeOp } from 'foundation-protocol'
import { expandPlacement, PlacementError } from './placement.js'

const ARTBOARD_OPS = new Set(['create-page', 'rename-page', 'reorder-page', 'duplicate-page', 'delete-page', 'create-artboard', 'rename-artboard', 'move-artboard', 'resize-artboard', 'standardize-artboard', 'set-artboard-padding', 'move-artboard-view', 'set-artboard-view-visible', 'set-artboard-view-size', 'separate-artboard-view', 'rename-viewport', 'rename-state', 'resize-viewport', 'duplicate-artboard', 'reorder-artboard', 'delete-artboard', 'upgrade-artboards'])

const COMPONENT_OPS = new Set(['detach-instance', 'swap-instance', 'set-instance-variant', 'set-instance-override', 'reset-instance-override', 'reset-instance-overrides'])

const MODE_OPS = new Set(['create-token-collection', 'add-token-mode', 'rename-token-mode', 'remove-token-mode', 'set-mode-token', 'set-collection-mode'])

export function isArtboardOperation(op: SessionOp): op is ArtboardOp { return ARTBOARD_OPS.has(op.op) }

function frameTarget(doc: FdnDocument, op: SessionOp): FdnNode | undefined {
  if (!('id' in op)) return undefined
  const node = indexNodes(doc.body).get(op.id)?.node
  if (node?.tag !== 'fdn-artboard') return undefined
  if (op.op === 'set-style') {
    if (op.value === null && node.style[op.prop] === undefined && node.attrs[`data-fdn-${op.prop}`] === undefined) return undefined
    return node
  }
  if (op.op === 'set-style-ref') return op.styleRef === null && node.styleRef === undefined ? undefined : node
  if (op.op === 'set-frame-mode') return node
  if (op.op === 'set-collection-mode') return op.mode === null && node.attrs[`data-fdn-mode-${op.collection}`] === undefined ? undefined : node
  if (op.op === 'set-attr' && (op.key.startsWith('data-fdn-mode-') || op.key === 'data-fdn-layout')) return op.value === null && node.attrs[op.key] === undefined ? undefined : node
  if (op.op === 'set-artboard-padding' && doc.specVersion === ARTBOARD_FRAME_VERSION) return node
  return undefined
}

export function expandSessionOps(doc: FdnDocument, ops: SessionOp[], reports: InstanceSwapReport[] = [], detaches: InstanceDetachReport[] = []): PatchOp[] {
  if (ops.some(op => op.op === 'import-image' || op.op === 'localize-images')) throw new Error('image operations require asset preparation')
  ops = ops.flatMap<SessionOp>(op => {
    if (op.op !== 'remove-state' && op.op !== 'remove-viewport') return [op]
    const key = op.op === 'remove-state' ? 'data-fdn-view-state' : 'data-fdn-view-viewport'
    const remove: PatchOp[] = [...indexNodes(doc.body).values()].filter(loc => loc.node.tag === 'fdn-artboard-view' && loc.node.attrs[key] === op.name).map(loc => ({ op: 'remove-node', id: loc.node.id }))
    return [...remove, op]
  })
  if (ops.every((op): op is PatchOp | PlacementOp => !MODE_OPS.has(op.op) && !COMPONENT_OPS.has(op.op) && !ARTBOARD_OPS.has(op.op) && !frameTarget(doc, op))) return expandPlacement(doc, ops)
  let working = doc
  const expanded: PatchOp[] = []
  for (const [position, op] of ops.entries()) {
    const root = frameTarget(working, op)
    const prefix = root ? promoteArtboardFrame(working, root) : []
    if (root && op.op === 'set-style' && /^overflow(?:-[xy])?$/.test(op.prop)) prefix.push({ op: 'set-attr', id: root.id, key: 'data-fdn-overflow', value: null })
    if (prefix.length) {
      const prepared = applyPatch(working, prefix, { validateTokens: false, validateComponents: false, validateStateStyles: false, validateArtboards: false })
      if (!prepared.ok) throw new PlacementError(prepared.error.code, prepared.error.message)
      working = prepared.doc
    }
    let batch: PatchOp[]
    if (ARTBOARD_OPS.has(op.op)) batch = expandArtboardOp(working, op as ArtboardOp)
    else if (COMPONENT_OPS.has(op.op)) batch = expandComponentOp(working, op as ComponentOp, reports, detaches)
    else if (!MODE_OPS.has(op.op)) batch = expandPlacement(working, [op as PatchOp | PlacementOp])
    else batch = modeOps(working, op as TokenModeOp)
    batch = [...prefix, ...batch]
    if (position === ops.length - 1) {
      expanded.push(...batch)
      break
    }
    const patch = applyPatch(working, batch, { validateTokens: false, validateComponents: false, validateStateStyles: false, validateArtboards: false })
    if (!patch.ok) throw new PlacementError(patch.error.code, patch.error.message)
    working = patch.doc
    expanded.push(...patch.applied)
  }
  return expanded
}

function modeOps(doc: FdnDocument, op: TokenModeOp): PatchOp[] {
  if (op.op === 'create-token-collection') {
    if (doc.tokenCollections?.some((item) => item.name === op.name)) throw new Error(`collection "${op.name}" already exists`)
    return [{ op: 'set-token-collection', collection: { name: op.name, modes: op.modes, tokens: [] } }]
  }
  const collection = structuredClone(doc.tokenCollections?.find((item) => item.name === op.collection))
  if (!collection) throw new Error(`unknown token collection "${op.collection}"`)
  const selected: PatchOp[] = []
  const key = `data-fdn-mode-${collection.name}`
  if (op.op === 'set-collection-mode') {
    if (!indexNodes(doc.body).has(op.id)) throw new PlacementError('unknown-node', `unknown node "${op.id}"`)
    if (op.mode !== null && !collection.modes.includes(op.mode)) throw new Error(`unknown mode "${op.mode}"`)
    return [{ op: 'set-attr', id: op.id, key, value: op.mode }]
  }
  if (op.op === 'add-token-mode') {
    if (collection.modes.includes(op.name)) throw new Error(`mode "${op.name}" already exists`)
    const from = op.from ?? collection.modes[0]!
    if (!collection.modes.includes(from)) throw new Error(`unknown source mode "${from}"`)
    collection.modes.push(op.name)
    for (const token of collection.tokens) token.values[op.name] = structuredClone(token.values[from]!)
  } else if (op.op === 'set-mode-token') {
    if (!collection.modes.includes(op.mode)) throw new Error(`unknown mode "${op.mode}"`)
    let token = collection.tokens.find((item) => item.name === op.name)
    if (!token) {
      if (!op.type) throw new Error('a new mode token needs a declared type')
      token = { name: op.name, type: op.type, values: Object.fromEntries(collection.modes.map((mode) => [mode, structuredClone(op.value)])) }
      collection.tokens.push(token)
    } else if (op.type && op.type !== token.type) throw new Error('changing a token type requires a complete validated collection update')
    token.values[op.mode] = structuredClone(op.value)
  } else {
    if (!collection.modes.includes(op.name)) throw new Error(`unknown mode "${op.name}"`)
    if (op.op === 'rename-token-mode' && collection.modes.includes(op.newName)) throw new Error(`mode "${op.newName}" already exists`)
    if (op.op === 'remove-token-mode' && collection.modes.length === 1) throw new Error('a collection must retain at least one mode')
    const update = (nodes: FdnNode[], template: boolean): boolean => {
      let changed = false
      for (const node of nodes) {
        if (node.attrs[key] === op.name) {
          if (op.op === 'remove-token-mode') throw new Error(`mode "${op.name}" is selected; switch those frames before removing it`)
          if (!template) selected.push({ op: 'set-attr', id: node.id, key, value: op.newName })
          node.attrs[key] = op.newName
          changed = true
        }
        if (update(node.children, template)) changed = true
      }
      return changed
    }
    update(structuredClone(doc.body), false)
    for (const component of structuredClone(doc.components)) {
      if (update(component.body, true)) selected.push({ op: 'set-component', component })
    }
    collection.modes = op.op === 'rename-token-mode' ? collection.modes.map((mode) => mode === op.name ? op.newName : mode) : collection.modes.filter((mode) => mode !== op.name)
    for (const token of collection.tokens) {
      if (op.op === 'rename-token-mode') token.values[op.newName] = token.values[op.name]!
      delete token.values[op.name]
    }
  }
  return [{ op: 'set-token-collection', collection }, ...selected]
}
