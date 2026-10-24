import type { FdnDocument, FdnNode, ReportLine, StateStyleKey } from '../types.js'
import { interpolateString, type ExprContext } from './expr.js'
import { mapStyleValues, mergeStyles, styleEntries } from './styles.js'

export interface ResolvedNodeStyle {
  attrs: Record<string, string>
  style: Record<string, string>
  styleStates: Partial<Record<StateStyleKey, Record<string, string>>>
}

export function resolveNodeStyle(node: FdnNode, doc: FdnDocument, context: ExprContext, reports: ReportLine[], audit: (prop: string, value: string) => void = () => {}): ResolvedNodeStyle {
  const attrs: Record<string, string> = {}
  for (const [key, raw] of Object.entries(node.attrs)) {
    const result = interpolateString(raw, context, node.id)
    reports.push(...result.reports)
    attrs[key] = result.value
  }
  const named = node.styleRef ? doc.namedStyles.find(style => style.name === node.styleRef) : undefined
  if (node.styleRef && !named) reports.push({ code: 'unknown-style-ref', severity: 'warning', message: `named style "${node.styleRef}" is not declared`, nodeId: node.id })
  const resolve = (prop: string, raw: string): string | undefined => {
    const result = interpolateString(raw, context, node.id)
    reports.push(...result.reports)
    if (/\bstate\s*\.\s*name\b/.test(raw) && result.reports.some(report => report.severity === 'error')) return undefined
    audit(prop, result.value)
    return result.value
  }
  const style = mapStyleValues(named ? mergeStyles(named.style, node.style) : node.style, resolve)
  if (node.styleRef) attrs['data-fdn-style'] = node.styleRef
  const styleStates: Partial<Record<StateStyleKey, Record<string, string>>> = {}
  for (const key of ['hover', 'focus', 'active', 'disabled'] as const) {
    const inherited = named?.styleStates[key], own = node.styleStates[key]
    if (!inherited && !own) continue
    const resolved = mapStyleValues(mergeStyles(inherited ?? {}, own ?? {}), resolve)
    if (!Object.keys(resolved).length) continue
    styleStates[key] = resolved
    attrs[`style-${key}`] = styleEntries(resolved).map(([prop, value]) => `${prop}:${value}`).join(';')
  }
  return { attrs, style, styleStates }
}
