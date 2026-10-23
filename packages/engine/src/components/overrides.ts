import type { ComponentSwapTarget, FdnComponent, FdnDocument, FdnNode, ReportLine, StateStyleKey } from '../types.js'
import { componentSelection } from './variants.js'
import { mergeStyles } from '../bake/styles.js'
import { validateStyleDeclarations } from '../validate/styles.js'
import { stableStringify } from '../chain/util.js'

export interface OverrideOrigin { node: FdnNode; owner: string; target: string[]; reason: string }
export interface LayerOverride { origin: OverrideOrigin; target: string[] }
export interface PreparedOverrides {
  body: FdnNode[]
  literalText: Map<string, string>
  marks: Map<string, { fields: Set<string>; records: LayerOverride[] }>
  nested: Map<string, LayerOverride[]>
  suppressed: Set<string>
  reports: ReportLine[]
}

export function overrideTarget(node: FdnNode): string[] | null {
  try {
    const value: unknown = JSON.parse(node.attrs.target ?? '')
    return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.length > 0) ? value : null
  } catch { return null }
}

export function definitionLayers(nodes: FdnNode[], ancestors: FdnNode[] = []): { node: FdnNode; ancestors: FdnNode[] }[] {
  return nodes.flatMap((node) => {
    if (node.tag === 'fdn-override') return []
    if (node.tag === 'fdn-fill') return definitionLayers(node.children, [...ancestors, node])
    const children = node.tag === 'fdn-use' ? node.children.filter((child) => child.tag === 'fdn-fill') : node.children
    return [{ node, ancestors }, ...definitionLayers(children, [...ancestors, node])]
  })
}

export function swapAttributes(attrs: Record<string, string>, target: ComponentSwapTarget): Record<string, string> {
  const next = Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== 'component' && key !== 'component-set' && !key.startsWith('data-fdn-variant-')))
  if ('component' in target) next.component = target.component
  else {
    next['component-set'] = target.componentSet
    for (const [axis, value] of Object.entries(target.variants ?? {})) next[`data-fdn-variant-${axis}`] = value
  }
  return next
}

export function overrideSwap(node: FdnNode): ComponentSwapTarget | null {
  if (node.attrs.component) return { component: node.attrs.component }
  if (node.attrs['component-set']) return { componentSet: node.attrs['component-set'], variants: Object.fromEntries(Object.entries(node.attrs).filter(([key]) => key.startsWith('data-fdn-variant-')).map(([key, value]) => [key.slice(17), value])) }
  return null
}

function hasOverrideValues(node: FdnNode): boolean {
  return Object.keys(node.attrs).some(key => key !== 'target') || Object.keys(node.style).length > 0 || Object.values(node.styleStates).some(style => style && Object.keys(style).length > 0)
}

export function ownOverrides(instance: FdnNode, owner: string): LayerOverride[] {
  return instance.children.filter((node) => node.tag === 'fdn-override' && hasOverrideValues(node)).flatMap((node) => {
    const target = overrideTarget(node)
    return target ? [{ origin: { node, owner, target, reason: 'target no longer exists' }, target }] : []
  })
}

export function resolveOverrideTarget(doc: FdnDocument, instance: FdnNode, target: string[]): { node: FdnNode; component: FdnComponent; ancestors: FdnNode[] } | null {
  let component: FdnComponent
  try { component = componentSelection(doc, instance).component } catch { return null }
  let records = ownOverrides(instance, instance.id)
  for (let index = 0; index < target.length; index++) {
    if (component.sealed) return null
    const matches = definitionLayers(component.body).filter((entry) => entry.node.id === target[index])
    if (matches.length !== 1) return null
    const found = matches[0]!
    let node = found.node
    for (const record of records.filter((entry) => entry.target.length === 1 && entry.target[0] === node.id)) {
      const swap = overrideSwap(record.origin.node)
      if (swap && node.tag === 'fdn-use') node = { ...node, attrs: swapAttributes(node.attrs, swap) }
    }
    if (index === target.length - 1) return { ...found, node, component }
    if (node.tag !== 'fdn-use') return null
    const inherited = records.filter((entry) => entry.target.length > 1 && entry.target[0] === node.id).map((entry) => ({ ...entry, target: entry.target.slice(1) }))
    records = [...ownOverrides(node, node.id), ...inherited]
    try { component = componentSelection(doc, node).component } catch { return null }
  }
  return null
}

export function prepareOverrides(component: FdnComponent, records: LayerOverride[]): PreparedOverrides {
  const prepared: PreparedOverrides = { body: [], literalText: new Map(), marks: new Map(), nested: new Map(), suppressed: new Set(), reports: [] }
  const counts = new Map<string, number>()
  for (const { node } of definitionLayers(component.body)) counts.set(node.id, (counts.get(node.id) ?? 0) + 1)
  for (const record of records) {
    const matches = definitionLayers(component.body).filter((entry) => entry.node.id === record.target[0])
    if (matches.length !== 1) record.origin.reason = matches.length ? 'definition identity is ambiguous' : 'target no longer exists'
    else if (record.target.length > 1 && matches[0]!.node.tag !== 'fdn-use') record.origin.reason = 'path no longer crosses a nested instance'
    else record.origin.reason = 'target is not rendered in the current state or slot content'
  }
  const fieldDormant = (record: LayerOverride, field: string, reason: string) => {
    record.origin.reason = reason
    prepared.reports.push({ code: 'override-field-dormant', severity: 'warning', message: reason, nodeId: record.origin.node.id, detail: { field, instanceId: record.origin.owner, target: record.origin.target } })
  }
  const literalStyles = (record: LayerOverride, style: Record<string, string>) => Object.fromEntries(Object.entries(style).filter(([prop, value]) => {
    if (!value.includes('{{')) return true
    fieldDormant(record, prop, 'override style values are literal CSS or token bindings, not template expressions')
    return false
  }))
  const walk = (nodes: FdnNode[]): FdnNode[] => nodes.map((source) => {
    let node = source
    if (source.tag === 'fdn-fill') return { ...source, children: walk(source.children) }
    if (counts.get(source.id) !== 1) return source.tag === 'fdn-use' ? { ...source, children: source.children.map((child) => child.tag === 'fdn-fill' ? { ...child, children: walk(child.children) } : child) } : { ...source, children: walk(source.children) }
    const direct = records.filter((entry) => entry.target.length === 1 && entry.target[0] === source.id)
    const nested = records.filter((entry) => entry.target.length > 1 && entry.target[0] === source.id)
    const fields = new Set<string>()
    const active: LayerOverride[] = []
    let hiddenOverride: boolean | undefined
    for (const record of direct) {
      if (node.tag.startsWith('fdn-') && !['fdn-use', 'fdn-overlay'].includes(node.tag)) {
        fieldDormant(record, 'target', 'target is no longer a rendered layer')
        continue
      }
      const payload = record.origin.node
      let attrs = { ...node.attrs }
      if (Object.hasOwn(payload.attrs, 'text') && (node.children.length > 0 || node.tag.startsWith('fdn-'))) fieldDormant(record, 'text', 'text target is no longer a native leaf')
      if (Object.hasOwn(payload.attrs, 'text') && node.children.length === 0 && !node.tag.startsWith('fdn-')) {
        prepared.literalText.set(node.id, payload.attrs.text!)
        fields.add('text')
        active.push(record)
      }
      if (payload.attrs.hidden === 'true' || payload.attrs.hidden === 'false') {
        hiddenOverride = payload.attrs.hidden === 'true'
        if (payload.attrs.hidden === 'true') attrs.hidden = ''
        else delete attrs.hidden
        fields.add('hidden')
        active.push(record)
      }
      const swap = overrideSwap(payload)
      if (swap && node.tag !== 'fdn-use') fieldDormant(record, 'swap', 'swap target is no longer an instance')
      if (swap && node.tag === 'fdn-use') {
        attrs = swapAttributes(attrs, swap)
        fields.add('swap')
        active.push(record)
      }
      const styleStates = { ...node.styleStates }
      for (const [state, declarations] of Object.entries(payload.styleStates)) {
        if (declarations && Object.keys(declarations).length) {
          const literal = literalStyles(record, declarations)
          styleStates[state as StateStyleKey] = mergeStyles(styleStates[state as StateStyleKey] ?? {}, literal)
          if (Object.keys(literal).length) { fields.add('styleStates'); active.push(record) }
        }
      }
      const literal = literalStyles(record, payload.style)
      if (Object.keys(literal).length) { fields.add('style'); active.push(record) }
      node = { ...node, attrs, style: mergeStyles(node.style, literal), styleStates }
    }
    if (hiddenOverride === true) prepared.suppressed.add(node.id)
    if (active.length) prepared.marks.set(node.id, { fields, records: active })
    if (nested.length && node.tag === 'fdn-use') {
      prepared.nested.set(node.id, nested.map((entry) => ({ ...entry, target: entry.target.slice(1) })))
    }
    return node.tag === 'fdn-use' ? { ...node, children: node.children.map((child) => child.tag === 'fdn-fill' ? { ...child, children: walk(child.children) } : child) } : { ...node, children: walk(node.children) }
  })
  prepared.body = walk(component.body)
  return prepared
}

export function validateInstanceOverrides(doc: FdnDocument): ReportLine[] {
  const issues: ReportLine[] = []
  const walk = (nodes: FdnNode[], parent?: FdnNode) => {
    for (const node of nodes) {
      if (node.tag === 'fdn-override') {
        const fail = (subject: string, message: string) => issues.push({ code: 'invalid-instance-override', severity: 'error', message, nodeId: node.id, detail: { owner: parent?.id ?? '', subject } })
        const target = overrideTarget(node)
        if (parent?.tag !== 'fdn-use' || !target) fail('target', 'an override needs an instance parent and a nonempty JSON array of definition identities')
        if (node.children.length || node.text !== undefined || node.when !== undefined || node.each !== undefined || node.styleRef !== undefined) fail('content', 'override metadata has no children, text content, when, each or style reference; put literal text in its text attribute')
        if (node.attrs.hidden !== undefined && !['true', 'false'].includes(node.attrs.hidden)) fail('hidden', 'override hidden must be true or false')
        const allowed = (key: string) => ['target', 'text', 'hidden', 'component', 'component-set'].includes(key) || key.startsWith('data-fdn-variant-')
        for (const key of Object.keys(node.attrs)) if (!allowed(key)) fail(`attribute:${key}`, `attribute "${key}" is not supported on override metadata`)
        if (node.attrs.component && node.attrs['component-set']) fail('swap', 'override swap selects either a component or a component set')
        if (!node.attrs['component-set'] && Object.keys(node.attrs).some((key) => key.startsWith('data-fdn-variant-'))) fail('swap', 'override variant values require a component-set swap')
        const resolved = parent && target ? resolveOverrideTarget(doc, parent, target) : null
        const swap = overrideSwap(node)
        if (swap && resolved?.node.tag === 'fdn-use') {
          try { componentSelection(doc, { attrs: swapAttributes(resolved.node.attrs, swap) }) } catch (err) {
            issues.push({ code: 'override-dormant', severity: 'warning', message: err instanceof Error ? err.message : String(err), nodeId: node.id, detail: { instanceId: parent?.id, target } })
          }
        }
        const parentLayer = resolved?.ancestors.at(-1)
        const opts = { nodeId: node.id, label: 'instance override', allowOverlayPosition: !resolved || resolved.ancestors.some((entry) => entry.tag === 'fdn-overlay'), allowFreePosition: parentLayer !== undefined && ['free', 'flow'].includes(parentLayer.attrs['data-fdn-layout'] ?? '') && ['relative', 'absolute'].includes(parentLayer.style.position ?? '') }
        const validatePlane = (plane: Record<string, string>) => {
          issues.push(...validateStyleDeclarations(plane, opts).map((issue) => issue.code === 'position-outside-overlay' ? { ...issue, severity: 'warning' as const } : issue))
          for (const [prop, value] of Object.entries(plane)) if (value.includes('{{')) fail(`style:${prop}`, 'override style values are literal CSS or token bindings, not template expressions')
        }
        validatePlane(node.style)
        for (const plane of Object.values(node.styleStates)) if (plane) validatePlane(plane)
        if (target && parent?.tag === 'fdn-use' && !resolved && hasOverrideValues(node)) issues.push({ code: 'override-dormant', severity: 'warning', message: `override target ${stableStringify(target)} is not present in the current definition`, nodeId: node.id, detail: { instanceId: parent.id, target } })
      }
      if (node.tag === 'fdn-use') {
        const targets = new Set<string>()
        for (const child of node.children.filter((entry) => entry.tag === 'fdn-override' && hasOverrideValues(entry))) {
          const target = overrideTarget(child)
          if (!target) continue
          const key = stableStringify(target)
          if (targets.has(key)) issues.push({ code: 'duplicate-override-target', severity: 'warning', message: `multiple overrides target ${key}; later child declarations win per property`, nodeId: child.id, detail: { instanceId: node.id, target } })
          targets.add(key)
        }
      }
      walk(node.children, node)
    }
  }
  walk(doc.body)
  for (const component of doc.components) walk(component.body)
  return issues
}
