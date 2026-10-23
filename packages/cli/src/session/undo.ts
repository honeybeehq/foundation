import { applyPatch, indexNodes, invertOp, stableStringify } from 'foundation-engine'
import type { FdnDocument, FdnNode, PatchOp } from 'foundation-engine'

export interface UndoStep {
  label: string
  revert: PatchOp[]
  repeat: PatchOp[]
  created: string[]
  placements: Record<string, { parent: string | null; previous: string | null }>
  removedFrom: Record<string, string | null>
  expected: Array<PatchOp | null>
  repeatExpected: Array<PatchOp | null>
  repeatPlacements: UndoStep['placements']
  createdOverrides: Map<string, FdnNode>
  retargetedOverrides: Set<string>
}

export function undoStep(label: string, revert: PatchOp[], before: FdnDocument, after: FdnDocument, repeat: PatchOp[]): UndoStep {
  const oldIndex = indexNodes(before.body)
  const newIndex = indexNodes(after.body)
  const created: string[] = []
  const placements: UndoStep['placements'] = {}
  const removedFrom: UndoStep['removedFrom'] = {}
  const collect = (node: FdnNode): void => { created.push(node.id); node.children.forEach(collect) }
  for (const op of revert) {
    if (op.op === 'remove-node') {
      const loc = newIndex.get(op.id)
      if (loc) { collect(loc.node); removedFrom[op.id] = loc.parent }
    }
    if (op.op === 'insert-node' || op.op === 'move-node') {
      const siblings = op.parent === null ? before.body : oldIndex.get(op.parent)?.node.children ?? []
      placements[op.op === 'insert-node' ? op.node.id : op.id] = { parent: op.parent, previous: siblings[op.index - 1]?.id ?? null }
    }
  }
  const expected = revert.map(op => { const inverse = invertOp(op, after, newIndex); return inverse === 'fallback' ? null : inverse })
  const repeatExpected = repeat.map(op => { const inverse = invertOp(op, before, oldIndex); return inverse === 'fallback' ? null : inverse })
  const repeatPlacements: UndoStep['placements'] = {}
  for (const op of repeat) if (op.op === 'insert-node' || op.op === 'move-node') {
    const siblings = op.parent === null ? after.body : newIndex.get(op.parent)?.node.children ?? []
    repeatPlacements[op.op === 'insert-node' ? op.node.id : op.id] = { parent: op.parent, previous: siblings[op.index - 1]?.id ?? null }
  }
  const createdOverrides = new Map<string, FdnNode>()
  for (const op of repeat) if (op.op === 'insert-node' && op.node.tag === 'fdn-override') createdOverrides.set(op.node.id, structuredClone(op.node))
  const retargetedOverrides = new Set<string>()
  for (const op of repeat) if (op.op === 'set-attr' && op.key === 'target' && (oldIndex.get(op.id)?.node.tag === 'fdn-override' || newIndex.get(op.id)?.node.tag === 'fdn-override')) retargetedOverrides.add(op.id)
  return { label, revert, repeat, created, placements, removedFrom, expected, repeatExpected, repeatPlacements, createdOverrides, retargetedOverrides }
}

export function oppositeStep(step: UndoStep, before: FdnDocument, after: FdnDocument): UndoStep {
  return { ...undoStep(step.label, step.repeat, before, after, step.revert), expected: step.repeatExpected, repeatExpected: step.expected, placements: step.repeatPlacements, repeatPlacements: step.placements, createdOverrides: step.createdOverrides, retargetedOverrides: step.retargetedOverrides }
}

function overrideFieldOps(owned: FdnNode, current: FdnNode, restore: boolean): PatchOp[] {
  const swapKey = (key: string) => key === 'component' || key === 'component-set' || key.startsWith('data-fdn-variant-')
  const attrs = new Set(Object.keys(owned.attrs).filter(key => key !== 'target'))
  if ([...attrs].some(swapKey)) for (const key of Object.keys(current.attrs)) if (swapKey(key)) attrs.add(key)
  const ops: PatchOp[] = [...attrs].map(key => ({ op: 'set-attr', id: current.id, key, value: restore ? owned.attrs[key] ?? null : null }))
  for (const prop of Object.keys(owned.style)) ops.push({ op: 'set-style', id: current.id, prop, value: restore ? owned.style[prop]! : null })
  for (const state of ['hover', 'focus', 'active', 'disabled'] as const) {
    for (const prop of Object.keys(owned.styleStates[state] ?? {})) ops.push({ op: 'set-style', id: current.id, prop, state, value: restore ? owned.styleStates[state]![prop]! : null })
  }
  return ops
}

function restoredValue(before: unknown, after: unknown, current: unknown): unknown {
  if (stableStringify(before) === stableStringify(after)) return current
  const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (object(before) && object(after) && object(current)) {
    const result: Record<string, unknown> = { ...current }
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!(key in before)) delete result[key]
      else Object.defineProperty(result, key, { value: restoredValue(before[key], after[key], current[key]), enumerable: true, configurable: true, writable: true })
    }
    return result
  }
  if (Array.isArray(before) && Array.isArray(after) && Array.isArray(current)) {
    const identity = (value: unknown): string | null => typeof value === 'string' ? value : object(value) && typeof (value.name ?? value.id) === 'string' ? String(value.name ?? value.id) : null
    if ([before, after, current].every(values => values.every(value => identity(value) !== null) && new Set(values.map(identity)).size === values.length)) {
      const previous = new Map(before.map(value => [identity(value), value]))
      const authored = new Map(after.map(value => [identity(value), value]))
      const result = current.filter(value => !authored.has(identity(value)) || previous.has(identity(value))).map(value => previous.has(identity(value)) ? restoredValue(previous.get(identity(value)), authored.get(identity(value)), value) : value)
      for (const value of before) if (!authored.has(identity(value)) && !result.some(item => identity(item) === identity(value))) result.push(value)
      if (stableStringify(before.map(identity)) !== stableStringify(after.map(identity))) {
        const rank = new Map(before.map((value, index) => [identity(value), index]))
        result.sort((a, b) => (rank.get(identity(a)) ?? before.length) - (rank.get(identity(b)) ?? before.length))
      }
      return result
    }
  }
  return structuredClone(before)
}

function valueRebase<T>(before: T, after: T, current: T | undefined): T {
  return restoredValue(before, after, current) as T
}

function rebaseValue(op: PatchOp, expected: PatchOp | null | undefined, current: FdnDocument): PatchOp {
  switch (op.op) {
    case 'set-token-collection': return expected?.op === op.op ? { ...op, collection: valueRebase(op.collection, expected.collection, current.tokenCollections?.find(item => item.name === op.collection.name)) } : op
    case 'set-named-style': return expected?.op === op.op ? { ...op, style: valueRebase(op.style, expected.style, current.namedStyles.find(item => item.name === op.style.name)) } : op
    case 'set-component': return expected?.op === op.op ? { ...op, component: valueRebase(op.component, expected.component, current.components.find(item => item.name === op.component.name)) } : op
    case 'set-component-set': return expected?.op === op.op ? { ...op, componentSet: valueRebase(op.componentSet, expected.componentSet, current.componentSets?.find(item => item.name === op.componentSet.name)) } : op
    case 'set-param': return expected?.op === op.op ? { ...op, param: valueRebase(op.param, expected.param, current.params.find(item => item.name === op.param.name)) } : op
    case 'set-state': return expected?.op === op.op ? { ...op, state: valueRebase(op.state, expected.state, current.states.find(item => item.name === op.state.name)) } : op
    case 'set-data': return expected?.op === op.op ? { ...op, data: valueRebase(op.data, expected.data, current.data.find(item => item.name === op.data.name)) } : op
    case 'set-lookup': return expected?.op === op.op ? { ...op, lookup: valueRebase(op.lookup, expected.lookup, current.lookups.find(item => item.name === op.lookup.name)) } : op
    case 'set-viewport': return expected?.op === op.op ? { ...op, viewport: valueRebase(op.viewport, expected.viewport, current.viewports.find(item => item.name === op.viewport.name)) } : op
    case 'annotate': return expected?.op === op.op ? { ...op, annotation: valueRebase(op.annotation, expected.annotation, current.annotations.find(item => item.id === op.annotation.id)) } : op
    default: return op
  }
}

export function undoOps(step: UndoStep, doc: FdnDocument): PatchOp[] {
  if (step.retargetedOverrides.size === 0 && step.revert.every(op => ['set-attr', 'set-style', 'set-style-ref', 'set-text', 'set-when'].includes(op.op))) return step.revert
  const created = new Set(step.created)
  let current = doc
  const out: PatchOp[] = []
  let skippedRetarget = false
  const apply = (op: PatchOp): void => {
    const patch = applyPatch(current, [op], { validateTokens: false, validateComponents: false })
    if (!patch.ok) throw new Error(patch.error.message)
    current = patch.doc
    out.push(...patch.applied)
  }
  for (const [position, original] of step.revert.entries()) {
    let op = rebaseValue(original, step.expected[position], current)
    if (op.op === 'replace-document') throw new Error('whole-document undo is not safe across writers')
    const index = indexNodes(current.body)
    if (op.op === 'set-attr' && op.key === 'target' && step.retargetedOverrides.has(op.id) && !index.has(op.id)) {
      skippedRetarget = true
      continue
    }
    if (op.op === 'remove-node') {
      const loc = index.get(op.id)
      if (!loc || loc.parent !== step.removedFrom[op.id]) throw new Error('inserted node was moved or removed by another writer')
      const owned = step.createdOverrides.get(op.id)
      if (owned && loc.node.tag !== 'fdn-override') throw new Error('override metadata was replaced by another writer')
      if (owned) {
        for (const field of overrideFieldOps(owned, loc.node, false)) apply(field)
        const remaining = indexNodes(current.body).get(op.id)!.node
        if (Object.keys(remaining.attrs).some(key => key !== 'target') || Object.keys(remaining.style).length || Object.values(remaining.styleStates).some(style => style && Object.keys(style).length)) continue
      }
      const foreign: string[] = []
      const visit = (node: FdnNode): void => {
        for (const child of node.children) {
          if (created.has(child.id)) visit(child)
          else foreign.push(child.id)
        }
      }
      visit(loc.node)
      for (const [offset, id] of foreign.entries()) apply({ op: 'move-node', id, parent: loc.parent, index: loc.index + offset })
    }
    if (op.op === 'insert-node' || op.op === 'move-node') {
      if (op.op === 'insert-node' && step.createdOverrides.get(op.node.id)) {
        const retained = index.get(op.node.id)
        if (retained) {
          if (retained.node.tag !== 'fdn-override' || retained.parent !== op.parent) throw new Error('override metadata was moved or replaced by another writer')
          for (const field of overrideFieldOps(step.createdOverrides.get(op.node.id)!, retained.node, true)) apply(field)
          continue
        }
      }
      const placement = step.placements[op.op === 'insert-node' ? op.node.id : op.id]
      if (placement) {
        const id = op.op === 'insert-node' ? op.node.id : op.id
        const siblings = (placement.parent === null ? current.body : index.get(placement.parent)?.node.children ?? []).filter(node => node.id !== id)
        const previous = siblings.findIndex(node => node.id === placement.previous)
        op = { ...op, index: placement.previous === null ? 0 : previous < 0 ? siblings.length : previous + 1 }
      }
    }
    apply(op)
  }
  if (skippedRetarget && out.length === 0) throw new Error('retargeted overrides were removed by another writer')
  return out
}
