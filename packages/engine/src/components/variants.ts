import type { FdnComponent, FdnComponentSet, FdnDocument, FdnNode, ReportLine } from '../types.js'
import { stableStringify } from '../chain/util.js'

export function componentSelection(doc: FdnDocument, node: Pick<FdnNode, 'attrs'>): { component: FdnComponent; values?: Record<string, string> } {
  const setName = node.attrs['component-set']
  if (!setName) {
    const component = doc.components.find((item) => item.name === node.attrs.component)
    if (!component) throw new Error(`component "${node.attrs.component ?? ''}" is not declared`)
    return { component }
  }
  if (node.attrs.component) throw new Error('an instance must reference either a component or a component set')
  const set = doc.componentSets?.find((item) => item.name === setName)
  if (!set) throw new Error(`component set "${setName}" is not declared`)
  const selected = Object.fromEntries(Object.entries(node.attrs).filter(([key]) => key.startsWith('data-fdn-variant-')).map(([key, value]) => [key.slice(17), value]))
  const values = { ...set.defaultVariant, ...selected }
  if (Object.keys(values).some((key) => !Object.hasOwn(set.properties, key)) || Object.entries(set.properties).some(([key, options]) => !options.includes(values[key]!))) throw new Error(`invalid variant values for component set "${setName}"`)
  const variants = set.variants.filter((item) => stableStringify(item.values) === stableStringify(values))
  if (variants.length !== 1) throw new Error(`no unique variant ${stableStringify(values)} in component set "${setName}"`)
  const component = doc.components.find((item) => item.name === variants[0]!.component)
  if (!component || component.sealed) throw new Error(`variant "${variants[0]!.component}" must be a native component`)
  return { component, values }
}

export function componentIssueKey(issue: ReportLine): string {
  return stableStringify({ code: issue.code, nodeId: issue.nodeId, detail: issue.detail })
}

export function validateComponentSets(doc: FdnDocument, opts?: { instances?: boolean }): ReportLine[] {
  const issues: ReportLine[] = []
  const attributeText = (value: string) => value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value)
  const names = new Set<string>()
  const members = new Set<string>()
  for (const set of doc.componentSets ?? []) {
    const fail = (subject: string, message: string) => issues.push({ code: 'invalid-component-set', severity: 'error', message, detail: { componentSet: set.name, subject } })
    if (!attributeText(set.name) || names.has(set.name) || doc.components.some((item) => item.name === set.name)) fail('name', `component set "${set.name}" needs a unique name distinct from component definitions`)
    names.add(set.name)
    const axes = Object.keys(set.properties)
    if (axes.length === 0) fail('properties', `component set "${set.name}" needs variant properties`)
    for (const [axis, options] of Object.entries(set.properties)) {
      if (!/^[a-z][a-z0-9-]*$/.test(axis) || options.length === 0 || options.some((value) => !attributeText(value)) || new Set(options).size !== options.length) fail(`axis:${axis}`, `invalid variant property "${axis}" on "${set.name}"`)
    }
    const validValues = (values: Record<string, string>) => Object.keys(values).length === axes.length && axes.every((axis) => Object.hasOwn(values, axis) && set.properties[axis]!.includes(values[axis]!))
    const combinations = new Set<string>()
    if (set.variants.length === 0) fail('variants', `component set "${set.name}" needs variants`)
    for (const variant of set.variants) {
      const key = stableStringify(variant.values)
      if (!validValues(variant.values) || combinations.has(key)) fail(`combination:${variant.component}`, `invalid or duplicate variant combination in "${set.name}": ${key}`)
      combinations.add(key)
      if (members.has(variant.component)) fail(`membership:${variant.component}`, `component "${variant.component}" may belong to only one variant combination`)
      members.add(variant.component)
      const component = doc.components.find((item) => item.name === variant.component)
      if (component) {
        if (component.props.some((prop) => axes.includes(prop.name))) fail(`props:${component.name}`, `variant axes and nonvariant props must have distinct names on "${component.name}"`)
        const ids = new Set<string>()
        const checkIds = (nodes: FdnNode[]) => {
          for (const node of nodes) {
            if (!attributeText(node.id) || ids.has(node.id)) fail(`identity:${component.name}:${node.id}`, `definition "${component.name}" needs unique nonempty layer identities`)
            ids.add(node.id)
            checkIds(node.children)
          }
        }
        checkIds(component.body)
      }
      if (!component || component.sealed) fail(`member:${variant.component}`, `variant "${variant.component}" in "${set.name}" must reference a native component`)
    }
    if (!validValues(set.defaultVariant) || !combinations.has(stableStringify(set.defaultVariant))) fail('default', `default variant of "${set.name}" must select a declared combination`)
  }
  if (opts?.instances === false) return issues
  const invalidSets = new Set(issues.map((issue) => (issue.detail as { componentSet: string }).componentSet))
  const walk = (nodes: FdnNode[], scope: string) => {
    for (const node of nodes) {
      const setName = node.attrs['component-set'] ?? ''
      const fail = (message: string) => issues.push({ code: 'invalid-instance-variant', severity: 'error', message, nodeId: node.id, detail: { componentSet: setName, subject: `${scope}:${node.id}` } })
      if (Object.keys(node.attrs).some((key) => key.startsWith('data-fdn-variant-')) && (node.tag !== 'fdn-use' || !setName)) fail('variant selections require a component set instance')
      if (node.tag === 'fdn-use' && setName) {
        if (invalidSets.has(setName)) fail(`component set "${setName}" has invalid declarations`)
        else try { componentSelection(doc, node) } catch (err) { fail(err instanceof Error ? err.message : String(err)) }
      }
      walk(node.children, scope)
    }
  }
  walk(doc.body, 'body')
  for (const component of doc.components) walk(component.body, `component:${component.name}`)
  return issues
}

export function isComponentSet(value: unknown): value is FdnComponentSet {
  const record = (item: unknown): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item)
  const stringMap = (item: unknown) => record(item) && Object.values(item).every((entry) => typeof entry === 'string')
  return record(value) && typeof value.name === 'string' && record(value.properties) && Object.values(value.properties).every((entry) => Array.isArray(entry) && entry.every((option) => typeof option === 'string')) && stringMap(value.defaultVariant) && Array.isArray(value.variants) && value.variants.every((entry) => record(entry) && typeof entry.component === 'string' && stringMap(entry.values))
}
