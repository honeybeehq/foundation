import { createHash } from 'node:crypto'
import type { FdnComponent, FdnDocument, FdnNode, InstanceSwapReport, PatchOp } from '../types.js'
import { stableStringify } from '../chain/util.js'
import { componentSelection } from './variants.js'
import { definitionLayers, overrideTarget, ownOverrides, prepareOverrides, resolveOverrideTarget } from './overrides.js'

function selectedAt(doc: FdnDocument, instance: FdnNode, path: string[]): FdnNode | null {
  if (!path.length) return instance
  const resolved = resolveOverrideTarget(doc, instance, path)
  return resolved?.node.tag === 'fdn-use' ? resolved.node : null
}

function layers(doc: FdnDocument, instance: FdnNode, path: string[]) {
  const use = selectedAt(doc, instance, path)
  if (!use) return []
  try {
    const { component } = componentSelection(doc, use)
    return component.sealed ? [] : definitionLayers(component.body)
  } catch { return [] }
}

function descriptor(entry: ReturnType<typeof definitionLayers>[number]): string | null {
  const name = entry.node.attrs['data-fdn-name']
  if (!name) return null
  return stableStringify([entry.node.tag, name, entry.ancestors.map((node) => node.attrs['data-fdn-name']).filter((value): value is string => !!value)])
}

function matchPath(doc: FdnDocument, before: FdnNode, after: FdnNode, target: string[], scope: string[]): string[] | null {
  const path = [...scope]
  for (let i = scope.length; i < target.length; i++) {
    const old = layers(doc, before, target.slice(0, i))
    const next = layers(doc, after, path)
    const exact = next.filter((entry) => entry.node.id === target[i])
    if (exact.length === 1) { path.push(exact[0]!.node.id); continue }
    if (exact.length) return null
    const sources = old.filter((entry) => entry.node.id === target[i])
    const key = sources.length === 1 ? descriptor(sources[0]!) : null
    if (!key || old.filter((entry) => descriptor(entry) === key).length !== 1) return null
    const matches = next.filter((entry) => descriptor(entry) === key)
    if (matches.length !== 1) return null
    path.push(matches[0]!.node.id)
  }
  return path
}

function instanceCycles(doc: FdnDocument, instance: FdnNode): Map<string, string> {
  const cycles = new Map<string, string>()
  const done = new Set<string>()
  const visit = (use: FdnNode, inherited: ReturnType<typeof ownOverrides>, stack: string[]) => {
    let component: FdnComponent
    try { component = componentSelection(doc, use).component } catch { return }
    if (stack.includes(component.name)) {
      const cycle = stack.slice(stack.indexOf(component.name))
      const key = cycle.map((_, i) => stableStringify([...cycle.slice(i), ...cycle.slice(0, i)])).sort()[0]!
      cycles.set(key, [...cycle, component.name].join(' → '))
      return
    }
    if (component.sealed) return
    const records = [...ownOverrides(use, use.id), ...inherited]
    const key = stableStringify([component.name, records.map((record) => [record.target, record.origin.node.attrs.component, record.origin.node.attrs['component-set'], Object.entries(record.origin.node.attrs).filter(([name]) => name.startsWith('data-fdn-variant-'))])])
    if (done.has(key)) return
    const prepared = prepareOverrides(component, records)
    for (const { node } of definitionLayers(prepared.body)) if (node.tag === 'fdn-use') visit(node, prepared.nested.get(node.id) ?? [], [...stack, component.name])
    done.add(key)
  }
  visit(instance, [], [])
  return cycles
}

export function assertInstanceAcyclic(doc: FdnDocument, instance: FdnNode, before?: FdnNode): void {
  const previous = before ? instanceCycles(doc, before) : new Map<string, string>()
  for (const [key, path] of instanceCycles(doc, instance)) if (!previous.has(key)) throw new Error(`swap would create a component cycle: ${path}`)
}

export function planInstanceSwap(doc: FdnDocument, before: FdnNode, incoming: FdnNode, scope: string[] = []): { ops: PatchOp[]; report: InstanceSwapReport } {
  const after = structuredClone(incoming)
  const selected = selectedAt(doc, after, scope)
  if (!selected) throw new Error('swap target is missing, ambiguous, or not an instance')
  const selection = componentSelection(doc, selected)
  assertInstanceAcyclic(doc, after, before)
  const oldSelected = selectedAt(doc, before, scope)
  let oldComponent: FdnComponent | undefined
  try { if (oldSelected) oldComponent = componentSelection(doc, oldSelected).component } catch {}
  const records = after.children.filter((node) => node.tag === 'fdn-override').flatMap((node) => {
    const from = overrideTarget(node)
    return from && from.length > scope.length && scope.every((part, i) => part === from[i]) ? [{ node, from }] : []
  })
  const groups = new Map<string, typeof records>()
  for (const record of records) {
    const key = stableStringify(record.from)
    groups.set(key, [...(groups.get(key) ?? []), record])
  }
  const outcomes = new Map<string, { to?: string[]; reason?: string }>()
  const depths = [...new Set(records.map((record) => record.from.length))].sort((a, b) => a - b)
  for (const depth of depths) {
    const proposals = [...groups.entries()].filter(([, group]) => group[0]!.from.length === depth).map(([key, group]) => ({ key, group, to: matchPath(doc, before, after, group[0]!.from, scope) }))
    for (const proposal of proposals) {
      const destination = proposal.to && stableStringify(proposal.to)
      const moved = destination !== proposal.key
      const collision = destination && moved && (groups.has(destination) || proposals.some((other) => other.key !== proposal.key && other.to && stableStringify(other.to) === destination))
      const outcome = collision ? { reason: 'retarget-collision' } : proposal.to ? { to: proposal.to } : { reason: 'no unique identity or named layer match' }
      outcomes.set(proposal.key, outcome)
      if (outcome.to) for (const record of proposal.group) record.node.attrs.target = JSON.stringify(outcome.to)
    }
  }
  const ops: PatchOp[] = []
  const overrides: InstanceSwapReport['overrides'] = records.map(({ node, from }) => {
    const outcome = outcomes.get(stableStringify(from))!
    const resolved = outcome.to ? resolveOverrideTarget(doc, after, outcome.to) : null
    const fromName = resolveOverrideTarget(doc, before, from)?.node.attrs['data-fdn-name']
    const toName = resolved?.node.attrs['data-fdn-name']
    const fields = [Object.hasOwn(node.attrs, 'text') && 'text', Object.hasOwn(node.attrs, 'hidden') && 'hidden', Object.keys(node.style).length > 0 && 'style', Object.values(node.styleStates).some((plane) => plane && Object.keys(plane).length) && 'styleStates', (node.attrs.component || node.attrs['component-set']) && 'swap'].filter((field): field is string => !!field)
    const compatible = (field: string) => !!resolved && (!resolved.node.tag.startsWith('fdn-') || ['fdn-use', 'fdn-overlay'].includes(resolved.node.tag)) && (field !== 'text' || (!resolved.node.tag.startsWith('fdn-') && !resolved.node.children.length)) && (field !== 'swap' || resolved.node.tag === 'fdn-use')
    const same = outcome.to && stableStringify(outcome.to) === stableStringify(from)
    if (outcome.to && !same) ops.push({ op: 'set-attr', id: node.id, key: 'target', value: JSON.stringify(outcome.to) })
    return { overrideId: node.id, ...(fromName ? { fromName } : {}), ...(toName ? { toName } : {}), from, ...(outcome.to ? { to: outcome.to } : {}), status: !outcome.to ? 'dormant' : same ? 'exact' : 'retargeted-by-name', ...(outcome.reason ? { reason: outcome.reason } : {}), compatibleFields: fields.filter(compatible), inactiveFields: fields.filter((field) => !compatible(field)) }
  })
  assertInstanceAcyclic(doc, after, before)
  const props: InstanceSwapReport['props'] = Object.entries(selected.attrs).filter(([key]) => key.startsWith('data-fdn-prop-')).map(([key, value]) => {
    const name = key.slice(14)
    const old = oldComponent?.props.find((prop) => prop.name === name)
    const next = selection.component.props.find((prop) => prop.name === name)
    const status = !next || selection.component.sealed ? 'inert' : next.type === 'enum' && !value.includes('{{') && !next.values?.includes(value) ? 'invalid-for-target' : old && old.type !== next.type ? 'reinterpreted' : 'kept'
    return { name, status, ...(old ? { fromType: old.type } : {}), ...(next ? { toType: next.type } : {}) }
  })
  const fills: InstanceSwapReport['fills'] = selected.children.filter((node) => node.tag === 'fdn-fill').map((node) => ({ fillId: node.id, slot: node.attrs.slot ?? '', status: selection.component.slots.includes(node.attrs.slot ?? '') && !selection.component.sealed ? 'kept' : 'inert' }))
  const data = { instanceId: before.id, scope, component: selection.component.name, ...(selected.attrs['component-set'] ? { componentSet: selected.attrs['component-set'] } : {}), ...(selection.values ? { values: selection.values } : {}), overrides, props, fills }
  return { ops, report: { ...data, signature: createHash('sha256').update(stableStringify(data)).digest('hex') } }
}
