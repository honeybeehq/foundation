import { randomUUID } from 'node:crypto'
import { detachInstance, applyPatch, planInstanceSwap, componentSelection, indexNodes, overrideTarget, resolveOverrideTarget, swapAttributes } from 'foundation-engine'
import type { FdnDocument, FdnNode, InstanceDetachReport, InstanceSwapReport, PatchOp, StateStyleKey } from 'foundation-engine'
import type { ComponentOp } from 'foundation-protocol'

export function expandComponentOp(doc: FdnDocument, op: ComponentOp, reports: InstanceSwapReport[] = [], detaches: InstanceDetachReport[] = []): PatchOp[] {
  if (op.op === 'detach-instance') {
    const plan = detachInstance(doc, op.id, op.state)
    detaches.push(plan.report)
    return plan.ops
  }
  const ops = componentOps(doc, op)
  const node = indexNodes(doc.body).get(op.id)?.node
  if (!node) return ops
  const scopes: string[][] = []
  if (op.op === 'swap-instance' || op.op === 'set-instance-variant') scopes.push([])
  if (op.op === 'set-instance-override' && op.values.swap !== undefined) scopes.push(op.target)
  if (op.op === 'reset-instance-override' || op.op === 'reset-instance-overrides') {
    for (const child of node.children) if (child.tag === 'fdn-override' && (child.attrs.component || child.attrs['component-set'])) {
      const target = overrideTarget(child)
      if (target && (op.op === 'reset-instance-overrides' || JSON.stringify(target) === JSON.stringify(op.target))) scopes.push(target)
    }
  }
  if (!scopes.length) return ops
  const patch = applyPatch(doc, ops, { validateTokens: false, validateComponents: false, validateStateStyles: false })
  if (!patch.ok) throw new Error(patch.error.message)
  let after = indexNodes(patch.doc.body).get(op.id)!.node
  const retargets: PatchOp[] = []
  for (const scope of scopes) {
    if (scope.length && !resolveOverrideTarget(doc, after, scope)) continue
    const plan = planInstanceSwap(doc, node, after, scope)
    if ('previewSignature' in op && op.previewSignature !== undefined && op.previewSignature !== plan.report.signature) throw new Error('swap preview changed; preview the swap again')
    reports.push(plan.report)
    retargets.push(...plan.ops)
    if (plan.ops.length) {
      const changed = applyPatch({ ...doc, body: [after] }, plan.ops, { validateTokens: false, validateComponents: false, validateStateStyles: false })
      if (!changed.ok) throw new Error(changed.error.message)
      after = changed.doc.body[0]!
    }
  }
  return [...ops, ...retargets]
}

function componentOps(doc: FdnDocument, op: Exclude<ComponentOp, { op: 'detach-instance' }>): PatchOp[] {
  const node = indexNodes(doc.body).get(op.id)?.node
  if (!node || node.tag !== 'fdn-use') throw new Error(`"${op.id}" must be a component instance`)
  if (op.op === 'swap-instance') {
    const attrs = swapAttributes(node.attrs, op.target)
    componentSelection(doc, { attrs })
    return attrDiff(node, attrs)
  }
  if (op.op === 'set-instance-variant') {
    if (!node.attrs['component-set']) throw new Error(`"${op.id}" must be a component set instance`)
    const attrs = { ...node.attrs }
    if (op.values === null) {
      for (const key of Object.keys(attrs)) if (key.startsWith('data-fdn-variant-')) delete attrs[key]
    } else {
      for (const [axis, value] of Object.entries(op.values)) {
        if (value === null) delete attrs[`data-fdn-variant-${axis}`]
        else attrs[`data-fdn-variant-${axis}`] = value
      }
    }
    componentSelection(doc, { attrs })
    return attrDiff(node, attrs)
  }
  const metadata = node.children.filter((child) => child.tag === 'fdn-override')
  if (op.op === 'reset-instance-overrides') return [...metadata].reverse().map((child) => ({ op: 'remove-node', id: child.id }))
  if (!op.target.length || op.target.some((part) => !part)) throw new Error('override target needs definition identities')
  const targetKey = JSON.stringify(op.target)
  const matching = metadata.filter((child) => JSON.stringify(overrideTarget(child)) === targetKey)
  if (op.op === 'reset-instance-override') return [...matching].reverse().map((child) => ({ op: 'remove-node', id: child.id }))
  const values = op.values
  const nonnull = values.text !== undefined && values.text !== null || values.hidden !== undefined && values.hidden !== null || values.swap !== undefined && values.swap !== null || Object.values(values.style ?? {}).some((value) => value !== null) || Object.values(values.styleStates ?? {}).some((plane) => plane && Object.values(plane).some((value) => value !== null))
  if (nonnull) {
    const resolved = resolveOverrideTarget(doc, node, op.target)
    if (!resolved) throw new Error('override target is missing, ambiguous, inside a fill, or sealed')
    if (resolved.node.tag.startsWith('fdn-') && !['fdn-use', 'fdn-overlay'].includes(resolved.node.tag)) throw new Error('override a rendered layer, not a slot or metadata wrapper')
    if (values.text !== undefined && values.text !== null && (resolved.node.children.length > 0 || resolved.node.tag.startsWith('fdn-'))) throw new Error('text override needs a native text leaf')
    if (values.swap) {
      if (resolved.node.tag !== 'fdn-use') throw new Error('nested swap override needs an instance target')
      componentSelection(doc, { attrs: swapAttributes(resolved.node.attrs, values.swap) })
    }
  }
  if (!matching.length && !nonnull) return []
  const fresh: FdnNode = { id: `o-${randomUUID()}`, tag: 'fdn-override', attrs: { target: targetKey }, style: {}, styleStates: {}, children: [] }
  const copies = (matching.length ? matching : [fresh]).map((child) => structuredClone(child))
  const destination = copies.at(-1)!
  const setAttr = (key: string, value: string | null | undefined) => {
    if (value === undefined) return
    if (value === null) for (const copy of copies) delete copy.attrs[key]
    else destination.attrs[key] = value
  }
  setAttr('text', values.text)
  setAttr('hidden', values.hidden === undefined || values.hidden === null ? values.hidden : String(values.hidden))
  if (values.swap !== undefined) {
    for (const copy of values.swap === null ? copies : [destination]) for (const key of Object.keys(copy.attrs)) if (key === 'component' || key === 'component-set' || key.startsWith('data-fdn-variant-')) delete copy.attrs[key]
    if (values.swap) Object.assign(destination.attrs, swapAttributes({}, values.swap))
  }
  for (const [prop, value] of Object.entries(values.style ?? {})) {
    if (value === null) for (const copy of copies) delete copy.style[prop]
    else destination.style[prop] = value
  }
  for (const [state, plane] of Object.entries(values.styleStates ?? {})) {
    if (!['hover', 'focus', 'active', 'disabled'].includes(state)) throw new Error('unsupported override interaction plane')
    if (!plane) continue
    const key = state as StateStyleKey
    for (const [prop, value] of Object.entries(plane)) {
      if (value === null) for (const copy of copies) { if (copy.styleStates[key]) delete copy.styleStates[key]![prop] }
      else { destination.styleStates[key] ??= {}; destination.styleStates[key]![prop] = value }
    }
  }
  const ops: PatchOp[] = []
  for (const copy of copies) {
    const before = matching.find((child) => child.id === copy.id)
    const empty = Object.keys(copy.attrs).every((key) => key === 'target') && Object.keys(copy.style).length === 0 && Object.values(copy.styleStates).every((plane) => !plane || !Object.keys(plane).length)
    if (empty) { if (before) ops.push({ op: 'remove-node', id: copy.id }); continue }
    if (!before) { ops.push({ op: 'insert-node', parent: node.id, index: node.children.length, node: copy }); continue }
    ops.push(...attrDiff(before, copy.attrs))
    for (const prop of new Set([...Object.keys(before.style), ...Object.keys(copy.style)])) if (before.style[prop] !== copy.style[prop]) ops.push({ op: 'set-style', id: copy.id, prop, value: copy.style[prop] ?? null })
    for (const state of ['hover', 'focus', 'active', 'disabled'] as const) {
      for (const prop of new Set([...Object.keys(before.styleStates[state] ?? {}), ...Object.keys(copy.styleStates[state] ?? {})])) if (before.styleStates[state]?.[prop] !== copy.styleStates[state]?.[prop]) ops.push({ op: 'set-style', id: copy.id, state, prop, value: copy.styleStates[state]?.[prop] ?? null })
    }
  }
  return ops
}

function attrDiff(node: FdnNode, attrs: Record<string, string>): PatchOp[] {
  const keys = new Set([...Object.keys(node.attrs), ...Object.keys(attrs)])
  return [...keys].filter((key) => node.attrs[key] !== attrs[key]).map((key) => ({ op: 'set-attr', id: node.id, key, value: attrs[key] ?? null }))
}
