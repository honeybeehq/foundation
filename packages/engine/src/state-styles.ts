import { extractInterpolations, extractLookupRefs, extractRefs, parseEachBinding } from './grammar/expr.js'
import type { FdnDocument, FdnNode, ReportLine } from './types.js'

export function stateStyleLookup(value: string | undefined): string | null {
  return value?.match(/^\s*\{\{\s*([A-Za-z_][A-Za-z0-9_-]*)\s*\[\s*state\s*\.\s*name\s*\]\s*\}\}\s*$/)?.[1] ?? null
}

export function validateStateStyles(doc: FdnDocument): ReportLine[] {
  const issues: ReportLine[] = []
  const tables = new Map<string, FdnDocument['lookups'][number]>()
  for (const table of doc.lookups) if (!tables.has(table.name)) tables.set(table.name, table)
  const check = (expression: string, nodeId?: string): void => {
    for (const ref of extractRefs(expression)) {
      if (ref.root === 'state' && (ref.path.length !== 1 || ref.path[0] !== 'name')) issues.push({ code: 'invalid-state-ref', severity: 'error', message: 'state.name is the only state reference', nodeId })
    }
    for (const lookup of extractLookupRefs(expression)) {
      if (lookup.ref.root !== 'state' || lookup.ref.path.length !== 1 || lookup.ref.path[0] !== 'name') continue
      const table = tables.get(lookup.lookupName)
      if (!table || !Object.hasOwn(table.entries, '')) issues.push({ code: 'invalid-state-style', severity: 'error', message: `state lookup "${lookup.lookupName}" needs a declared table and an authored empty-key default`, nodeId, detail: { lookup: lookup.lookupName } })
    }
  }
  const values = (items: string[], nodeId?: string): void => {
    for (const value of items) for (const expression of extractInterpolations(value)) check(expression, nodeId)
  }
  const walk = (nodes: FdnNode[]): void => {
    for (const node of nodes) {
      if (node.each && parseEachBinding(node.each)?.alias === 'state') issues.push({ code: 'reserved-state-binding', severity: 'error', message: 'state is read-only; choose another each alias', nodeId: node.id })
      if (node.when) check(node.when, node.id)
      values([...Object.values(node.attrs), node.text ?? '', ...Object.values(node.style), ...Object.values(node.styleStates).flatMap(plane => Object.values(plane ?? {}))], node.id)
      walk(node.children)
    }
  }
  walk(doc.body)
  for (const component of doc.components) walk(component.body)
  for (const style of doc.namedStyles) values([...Object.values(style.style), ...Object.values(style.styleStates).flatMap(plane => Object.values(plane ?? {}))])
  return issues
}
