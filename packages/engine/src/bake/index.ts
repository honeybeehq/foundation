import { selectArtboard } from '../artboards/index.js'
import { ownOverrides, overrideTarget, prepareOverrides, resolveOverrideTarget } from '../components/overrides.js'
import type { OverrideOrigin, PreparedOverrides } from '../components/overrides.js'
import { componentSelection, validateComponentSets } from '../components/variants.js'
import { mapStyleValues, mergeStyles, styleEntries } from './styles.js'
/**
 * bakeDocument — template + state → BakeResult (see API.md, src/types.ts).
 *
 * Pipeline (per node, depth-first over doc.body):
 *   1. state resolution → a flat params bag (defaults, or a named state's
 *      assignments layered over defaults; missing default → empty + report).
 *   2. each expansion (before when: an each-node is expanded first, then
 *      each iteration is independently when-gated in its own scope).
 *   3. when gating (drop node if false; malformed when → false + report).
 *   4. fdn-overlay trigger-binding exclusion (Q13 candidate v0 rule).
 *   5. fdn-use component instantiation (props bound + typed, slots filled,
 *      recursion with a component-name cycle guard).
 *   6. fdn-slot resolution inside a component body (fill content, baked in
 *      the *caller's* scope, or the slot's own default content).
 *   7. interpolation of text/attrs/style values.
 *   8. named-style inlining (styleRef merged under the node's own style —
 *      node wins) + styleStates → style-hover/-focus/-active/-disabled.
 *   9. conformance audit (category-aware off-token values, unused tokens)
 *      threaded throughout steps 7–8.
 *   10. report dedup (see dedupeReports) as the very last step, over the
 *       whole accumulated report — never during the walk, so nothing about
 *       the walk itself depends on report contents.
 */

import { validateTokenCollections } from '../tokens/index.js'
import type {
  ConformanceReport,
  FdnComponent,
  FdnDocument,
  FdnNamedStyle,
  FdnNode,
  FdnParamType,
  FdnProp,
  FdnState,
  NodeId,
  ReportLine,
  StateStyleKey,
} from '../types.js'
import { evaluateWhen, interpolateString, resolveRef, stringifyValue, type ExprContext } from './expr.js'
import { emitEditorHtml, emitHtml } from './emit.js'
import { capsuleClassName, parseSealedFragment, scopeCss } from './capsule.js'

export { emitHtml } from './emit.js'
export * from './expr.js'
export { capsuleClassName, parseSealedFragment, scopeCss } from './capsule.js'

const STATE_STYLE_KEYS: StateStyleKey[] = ['hover', 'focus', 'active', 'disabled']

interface Materialization {
  mode: 'one-level' | 'preserve-uses'
  state: string | null
  preserved: Set<FdnNode>
  dropped: Set<string>
}

interface BakeCtx extends ExprContext {
  materialization?: Materialization
  preserveSourceIds?: boolean
  doc: FdnDocument
  selectedState: string | null
  componentStack: string[]
  invalidComponentSets: Set<string>
  usedOverrides: Set<OverrideOrigin>
  componentOverrides?: PreparedOverrides
  instancePath: string[]
  slotFills?: Record<string, FdnNode[]>
  reports: ReportLine[]
  tokenValueIndex: Map<string, string[]>
  referencedTokens: Set<string>
  /** capsule class name -> scoped css text (bake/capsule.ts), shared by
   *  reference across every ctx spread — same accumulation pattern as
   *  `reports`/`referencedTokens` below. */
  capsuleCss: Map<string, string>
  editor?: { idPrefix: string }
}

function pushReport(ctx: BakeCtx, line: ReportLine): void {
  ctx.reports.push(line)
}

export function bakeDocument(doc: FdnDocument, opts?: { state?: string; artboardId?: string | null; viewport?: string | null; includeNodeIds?: boolean }): { html: string; tree: FdnNode[]; state: string | null; artboardId: string | null; report: ConformanceReport } {
  const issue = validateTokenCollections(doc)[0]
  if (issue) throw new Error(issue.message)
  let selected: ReturnType<typeof selectArtboard>
  try { selected = selectArtboard(doc, opts?.artboardId, opts) } catch (err) {
    return { html: '', tree: [], state: opts?.state ?? null, artboardId: opts?.artboardId ?? null, report: { lines: [{ code: String(err).match(/ambiguous-artboard|unknown-artboard|unknown-viewport|invalid-artboard-geometry|invalid-artboard-padding/)?.[0] ?? 'invalid-artboard', severity: 'error', message: String(err) }] } }
  }
  doc = selected.doc
  const stateName = opts?.state ?? null
  const { tree, capsuleCss, report } = bakeTree(doc, stateName, false)
  return { html: emitHtml(doc, tree, capsuleCss, selected.view, opts?.includeNodeIds), tree, state: stateName, artboardId: selected.artboardId, report }
}

export function bakeEditorDocument(doc: FdnDocument, opts?: { state?: string; artboardId?: string | null; viewport?: string | null }): { html: string; tree: FdnNode[]; state: string | null; artboardId: string | null; report: ConformanceReport } {
  const issue = validateTokenCollections(doc)[0]
  if (issue) throw new Error(issue.message)
  let selected: ReturnType<typeof selectArtboard>
  try { selected = selectArtboard(doc, opts?.artboardId, opts) } catch (err) {
    return { html: '', tree: [], state: opts?.state ?? null, artboardId: opts?.artboardId ?? null, report: { lines: [{ code: String(err).match(/ambiguous-artboard|unknown-artboard|unknown-viewport|invalid-artboard-geometry|invalid-artboard-padding/)?.[0] ?? 'invalid-artboard', severity: 'error', message: String(err) }] } }
  }
  doc = selected.doc
  const stateName = opts?.state ?? null
  const { tree, capsuleCss, report } = bakeTree(doc, stateName, true)
  return { html: emitEditorHtml(doc, tree, capsuleCss, selected.view), tree, state: stateName, artboardId: selected.artboardId, report }
}

export function bakeEditorComponent(doc: FdnDocument, name: string): { html: string; tree: FdnNode[]; report: ConformanceReport } {
  const issue = validateTokenCollections(doc)[0]
  if (issue) throw new Error(issue.message)
  const componentSet = doc.componentSets?.find((item) => item.name === name)
  const component = componentSet ? componentSelection(doc, { attrs: { 'component-set': name } }).component : doc.components.find((c) => c.name === name)
  const samples = component && !component.sealed ? sampleProps(component) : {}
  const sampled = Object.keys(samples)
  const attrs: Record<string, string> = componentSet ? { 'component-set': name } : { component: name }
  for (const [prop, value] of Object.entries(samples)) attrs[`data-fdn-prop-${prop}`] = value
  if (sampled.length > 0) attrs['data-fdn-sample'] = sampled.join(',')
  const instance: FdnNode = { id: name, tag: 'fdn-use', attrs, style: {}, styleStates: {}, children: [] }
  const { tree, capsuleCss, report } = bakeTree({ ...doc, body: [instance] }, null, true)
  const lines = report.lines.filter((line) => line.code !== 'unused-token')
  if (sampled.length > 0) {
    lines.push({
      code: 'sample-props',
      severity: 'info',
      message: `display-only sample values for props without defaults: ${sampled.join(', ')}`,
      detail: { props: samples },
    })
  }
  return { html: emitEditorHtml(doc, tree, capsuleCss), tree, report: { lines } }
}

function sampleProps(component: FdnComponent): Record<string, string> {
  const samples: Record<string, string> = {}
  for (const prop of component.props) {
    if (prop.default !== undefined) continue
    const sample = sampleValue(prop, component.body)
    if (sample !== undefined) samples[prop.name] = sample
  }
  return samples
}

function comparedLiteral(propName: string, body: FdnNode[]): string | undefined {
  const name = propName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const literal = `'([^']*)'|"([^"]*)"`
  const patterns = [new RegExp(`prop\\.${name}\\s*[!=]=\\s*(?:${literal})`), new RegExp(`(?:${literal})\\s*[!=]=\\s*prop\\.${name}\\b`)]
  const find = (expression: string | undefined): string | undefined => {
    if (!expression) return undefined
    const hits = patterns.map((pattern) => pattern.exec(expression)).filter((match): match is RegExpExecArray => match !== null)
    const first = hits.sort((a, b) => a.index - b.index)[0]
    return first ? (first[1] ?? first[2]) : undefined
  }
  for (const node of body) {
    const found =
      find(node.when) ??
      Object.values(node.attrs).map(find).find((value) => value !== undefined) ??
      Object.values(node.style).map(find).find((value) => value !== undefined) ??
      find(node.text) ??
      comparedLiteral(propName, node.children)
    if (found !== undefined) return found
  }
  return undefined
}

function sampleValue(prop: FdnProp, body: FdnNode[]): string | undefined {
  switch (prop.type) {
    case 'string':
      return comparedLiteral(prop.name, body) ?? prop.name
    case 'enum':
      return prop.values?.[0] ?? comparedLiteral(prop.name, body)
    case 'boolean':
      return 'false'
    case 'number':
      return '0'
    case 'list': {
      const fields = prop.values ?? []
      if (fields.length === 0) return '[]'
      return JSON.stringify([1, 2].map((n) => Object.fromEntries(fields.map((field) => [field, `${field} ${n}`]))))
    }
    case 'record':
      return '{}'
    default:
      return undefined
  }
}

function bakeTree(doc: FdnDocument, stateName: string | null, editor: boolean, materialization?: Materialization): { tree: FdnNode[]; capsuleCss: Map<string, string>; report: ConformanceReport } {
  const reports: ReportLine[] = []

  let state: FdnState | undefined
  if (stateName !== null) {
    state = doc.states.find((s) => s.name === stateName)
    if (!state) {
      reports.push({
        code: 'unknown-state',
        severity: 'error',
        message: `state "${stateName}" is not declared; baking with defaults only`,
      })
    }
  }

  const params: Record<string, unknown> = {}
  for (const p of doc.params) {
    if (state && Object.prototype.hasOwnProperty.call(state.assignments, p.name)) {
      params[p.name] = state.assignments[p.name]
    } else if (p.default !== undefined) {
      params[p.name] = p.default
    } else {
      params[p.name] = ''
      reports.push({
        code: 'param-missing-default',
        severity: 'warning',
        message: `param "${p.name}" has no default and no state assignment; baked empty`,
      })
    }
  }

  const tokenValueIndex = new Map<string, string[]>()
  for (const [name, value] of Object.entries(doc.tokens)) {
    const arr = tokenValueIndex.get(value) ?? []
    arr.push(name)
    tokenValueIndex.set(value, arr)
  }

  const ctx: BakeCtx = {
    doc,
    selectedState: stateName,
    ...(materialization ? { materialization } : {}),
    bindings: { prop: {}, param: params, state: { name: stateName ?? '' } },
    lookups: doc.lookups,
    componentStack: [],
    instancePath: [],
    usedOverrides: new Set(),
    invalidComponentSets: new Set(validateComponentSets(doc, { instances: false }).map((issue) => (issue.detail as { componentSet: string }).componentSet)),
    reports,
    tokenValueIndex,
    referencedTokens: new Set(),
    capsuleCss: new Map(),
    ...(editor ? { editor: { idPrefix: '' } } : {}),
  }

  const tree = doc.body.flatMap((n) => bakeNode(n, ctx))

  for (const name of Object.keys(doc.tokens)) {
    if (!ctx.referencedTokens.has(name)) {
      reports.push({
        code: 'unused-token',
        severity: 'info',
        message: `token "--${name}" is declared but never referenced via var(--${name}) in the baked output`,
      })
    }
  }

  return { tree, capsuleCss: ctx.capsuleCss, report: { lines: dedupeReports(reports) } }
}

/**
 * Collapse report-line noise (round 3 report hygiene). The dominant source
 * of duplication is NOT the same node reporting twice — it's the same
 * template expression (e.g. an off-token style value, or a component prop
 * binding) evaluating identically at every `each`/component-instance site
 * that reuses it: one `<fdn-use component="QueueRow">` used 8 times produces
 * the same "off-token-value ... font-weight ..." line 8 times with 8
 * different (instance-namespaced) nodeIds. Grouping by nodeId as well as
 * (code, message) would therefore never collapse the case this exists to
 * fix, so the group key is (code, severity, message) only; nodeId stops
 * identifying a single node once N>1 lines collapse into one, so it's
 * dropped from the collapsed line (kept as-is when N===1 — no information
 * lost for a genuine one-off).
 */
function dedupeReports(lines: ReportLine[]): ReportLine[] {
  const order: string[] = []
  const groups = new Map<string, { first: ReportLine; count: number }>()
  for (const line of lines) {
    const key = `${line.code} ${line.severity} ${line.message}`
    const existing = groups.get(key)
    if (existing) {
      existing.count++
    } else {
      groups.set(key, { first: line, count: 1 })
      order.push(key)
    }
  }
  return order.map((key) => {
    const { first, count } = groups.get(key) as { first: ReportLine; count: number }
    if (count === 1) return first
    const baseDetail = first.detail !== null && typeof first.detail === 'object' ? (first.detail as Record<string, unknown>) : undefined
    return {
      ...first,
      nodeId: undefined,
      message: `${first.message} (x${count})`,
      detail: { ...baseDetail, count },
    }
  })
}

// ——— each / when / dispatch ———

function matchesStateScope(node: FdnNode, state: string | null): boolean {
  const scope = node.attrs['data-fdn-state']
  return state === null || scope === undefined || scope === state
}

function bakeNode(node: FdnNode, ctx: BakeCtx): FdnNode[] {
  if (!matchesStateScope(node, ctx.selectedState)) return []
  if (node.tag === 'fdn-override') return []
  if (ctx.componentOverrides?.suppressed.has(node.id)) { markOverrides(node, ctx); return [] }
  if (node.each) {
    return bakeEach(node, ctx)
  }
  return bakeSingle(node, ctx)
}

function parseEachSpec(each: string): { binding: string; source: string } | undefined {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+?)\s*$/.exec(each)
  if (!m) return undefined
  const binding = m[1] as string
  const source = m[2] as string
  return { binding, source }
}

function toBindable(item: unknown): Record<string, unknown> {
  if (item !== null && typeof item === 'object' && !Array.isArray(item)) return item as Record<string, unknown>
  // Primitive list items (list-typed params have an informal item shape per
  // types.ts) are wrapped so `{{ x.value }}` reaches them under the ref
  // grammar, which requires a dotted path. See final-report contract note.
  return { value: item }
}

// `data.<name>` is the sanctioned each-source shape (matches validate's
// checkEachSource and every board) — dispatched first, ahead of the generic
// dotted-ref fallback, since 'data' is not a binding prefix resolveRef knows
// about and would otherwise always fail as unknown-ref (the zero-items bug).
const DATA_EACH_SOURCE = /^data\.([A-Za-z_][A-Za-z0-9_]*)$/

function resolveEachSource(source: string, node: FdnNode, ctx: BakeCtx): unknown[] | undefined {
  const trimmed = source.trim()

  const dataMatch = DATA_EACH_SOURCE.exec(trimmed)
  if (dataMatch) {
    const setName = dataMatch[1] as string
    const ds = ctx.doc.data.find((d) => d.name === setName)
    if (!ds) {
      pushReport(ctx, { code: 'unknown-ref', severity: 'warning', message: `each source "${trimmed}" is not a declared data set`, nodeId: node.id })
      return undefined
    }
    return ds.items
  }

  // Dotted, non-`data.` sources: prop./param. list-typed refs, or a ref into
  // a bound each-alias (nested each, e.g. "member in group.members").
  if (trimmed.includes('.')) {
    const path = trimmed.split('.')
    const r = resolveRef(path, ctx)
    if (!r.ok) {
      pushReport(ctx, { code: 'unknown-ref', severity: 'warning', message: `each source "${trimmed}" not found`, nodeId: node.id })
      return undefined
    }
    if (!Array.isArray(r.value)) {
      pushReport(ctx, { code: 'each-source-not-list', severity: 'error', message: `each source "${trimmed}" did not resolve to a list`, nodeId: node.id })
      return undefined
    }
    return r.value
  }

  // Bare data-set name: deprecated back-compat form. `validate` requires the
  // dotted `data.<name>` shape, so this always trips a report line even on
  // success — the deprecation is the point, not an error.
  const ds = ctx.doc.data.find((d) => d.name === trimmed)
  if (!ds) {
    pushReport(ctx, { code: 'unknown-ref', severity: 'warning', message: `each source "${trimmed}" is not a declared data set`, nodeId: node.id })
    return undefined
  }
  pushReport(ctx, {
    code: 'each-bare-data-source',
    severity: 'warning',
    message: `each source "${trimmed}" uses the deprecated bare data-set name; write "data.${trimmed}" instead (the shape validate requires)`,
    nodeId: node.id,
  })
  return ds.items
}

function bakeEach(node: FdnNode, ctx: BakeCtx): FdnNode[] {
  const spec = parseEachSpec(node.each as string)
  if (!spec) {
    pushReport(ctx, { code: 'expr-parse-error', severity: 'error', message: `malformed each="${node.each}" (expected "<name> in <ref>")`, nodeId: node.id })
    return []
  }
  if (spec.binding === 'state') {
    pushReport(ctx, { code: 'reserved-state-binding', severity: 'error', message: 'state is read-only; choose another each alias', nodeId: node.id })
    return []
  }
  const items = resolveEachSource(spec.source, node, ctx)
  if (!items) return []
  const stripped: FdnNode = { ...node, each: undefined }
  const out: FdnNode[] = []
  items.forEach((item, i) => {
    const childBindings = { ...ctx.bindings, [spec.binding]: toBindable(item) }
    const childCtx: BakeCtx = { ...ctx, bindings: childBindings }
    const baked = bakeSingle(stripped, childCtx)
    const indexed = ctx.editor ? baked.map((n) => ({ ...n, attrs: { ...n.attrs, 'data-fdn-index': String(i) } })) : baked
    out.push(...prefixIds(indexed, `${node.id}#${i}`, ctx.materialization?.preserved))
  })
  return out
}

function prefixIds(nodes: FdnNode[], prefix: string, preserved?: Set<FdnNode>): FdnNode[] {
  return nodes.map((n) => {
    const next = { ...n, id: preserved?.has(n) ? n.id : `${prefix}::${n.id}`, children: prefixIds(n.children, prefix, preserved) }
    if (preserved?.has(n)) preserved.add(next)
    return next
  })
}

function bakeSingle(node: FdnNode, ctx: BakeCtx): FdnNode[] {
  if (node.tag === 'fdn-overlay' && 'data-fdn-trigger' in node.attrs && !node.when) {
    pushReport(ctx, {
      code: 'trigger-overlay-skipped',
      severity: 'info',
      message: `overlay "${node.id}" has data-fdn-trigger with no when guard; excluded from this bake`,
      nodeId: node.id,
    })
    return []
  }

  if (node.when) {
    const { value, reports } = evaluateWhen(node.when, ctx, node.id)
    ctx.reports.push(...reports)
    if (!value) return []
  }

  if (node.tag === 'fdn-use') return ctx.materialization?.mode === 'preserve-uses' ? preserveInstance(node, ctx) : instantiateComponent(node, ctx)
  if (node.tag === 'fdn-slot') return resolveSlot(node, ctx)
  return [buildRegularNode(node, ctx)]
}

// ——— style / attrs ———

interface ResolvedStyle {
  attrs: Record<string, string>
  style: Record<string, string>
  styleStates: Partial<Record<StateStyleKey, Record<string, string>>>
}

// ——— off-token-value: category-aware matching (round 3 report hygiene) ———
//
// A raw value that happens to numerically/textually equal SOME declared
// token's value is not necessarily a *relevant* suggestion — "8px" matches
// both --space-2 and --radius-lg by coincidence, and suggesting a radius
// token for a padding declaration ("radius-lg for padding") is noise, not
// help. Categories are matched two ways:
//   - name-prefix category: the token's OWN NAME starts with a reserved
//     prefix (space-, radius-, font-size-, font-weight-) — this is the
//     token-authoring convention the audit assumes design-system tokens
//     follow (see docs/SPEC.md D1's token-taxonomy intent).
//   - color category: matched BY VALUE instead of by name (a hex/rgb/hsl
//     shaped value is unambiguously a color regardless of what its token
//     happens to be named), since color tokens aren't guaranteed a uniform
//     name prefix the way spacing/radius/type scales are.
// A token with neither a recognized name prefix nor a color-shaped value is
// "unprefixed": it cannot be placed in any category, so it can never satisfy
// a category-gated property match (same-category impossibility) and is
// simply skipped — never suggested, regardless of value equality alone.
type TokenCategory = 'space' | 'radius' | 'font-size' | 'font-weight' | 'color'

const PROPERTY_CATEGORY: Record<string, TokenCategory> = {
  padding: 'space',
  'padding-top': 'space',
  'padding-right': 'space',
  'padding-bottom': 'space',
  'padding-left': 'space',
  margin: 'space',
  'margin-top': 'space',
  'margin-right': 'space',
  'margin-bottom': 'space',
  'margin-left': 'space',
  gap: 'space',
  'row-gap': 'space',
  'column-gap': 'space',
  inset: 'space',
  top: 'space',
  right: 'space',
  bottom: 'space',
  left: 'space',
  'border-radius': 'radius',
  'border-top-left-radius': 'radius',
  'border-top-right-radius': 'radius',
  'border-bottom-left-radius': 'radius',
  'border-bottom-right-radius': 'radius',
  'font-size': 'font-size',
  'font-weight': 'font-weight',
  color: 'color',
  'background-color': 'color',
  'border-color': 'color',
  'border-top-color': 'color',
  'border-right-color': 'color',
  'border-bottom-color': 'color',
  'border-left-color': 'color',
  'outline-color': 'color',
}

const NAME_PREFIX_CATEGORIES: { prefix: string; category: TokenCategory }[] = [
  { prefix: 'space-', category: 'space' },
  { prefix: 'radius-', category: 'radius' },
  { prefix: 'font-size-', category: 'font-size' },
  { prefix: 'font-weight-', category: 'font-weight' },
]

const COLOR_VALUE_RE = /^(#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\()/i

function tokenCategory(tokenName: string, tokenValue: string): TokenCategory | undefined {
  for (const { prefix, category } of NAME_PREFIX_CATEGORIES) {
    if (tokenName.startsWith(prefix)) return category
  }
  if (COLOR_VALUE_RE.test(tokenValue.trim())) return 'color'
  return undefined
}

function auditStyleValue(prop: string, value: string, ctx: BakeCtx, nodeId: NodeId): void {
  const varRe = /var\(\s*--([A-Za-z0-9_-]+)/g
  let m: RegExpExecArray | null
  let sawVar = false
  while ((m = varRe.exec(value)) !== null) {
    sawVar = true
    ctx.referencedTokens.add(m[1] as string)
  }
  if (sawVar) return
  const trimmed = value.trim()
  if (trimmed === '') return

  const propCategory = PROPERTY_CATEGORY[prop]
  if (!propCategory) return // no category for this property: same-category impossibility -> skip

  const candidates = ctx.tokenValueIndex.get(trimmed) ?? []
  const matches = candidates.filter((name) => tokenCategory(name, trimmed) === propCategory)
  if (matches.length > 0) {
    pushReport(ctx, {
      code: 'off-token-value',
      severity: 'info',
      message: `value "${value}" for "${prop}" matches token(s) ${matches.join(', ')} — consider var(--${matches[0]})`,
      nodeId,
      detail: { prop, value, tokens: matches, category: propCategory },
    })
  }
}

function resolveNodeStyle(node: FdnNode, ctx: BakeCtx): ResolvedStyle {
  const attrs: Record<string, string> = {}
  for (const [k, v] of Object.entries(node.attrs)) {
    const { value, reports } = interpolateString(v, ctx, node.id)
    ctx.reports.push(...reports)
    attrs[k] = value
  }

  const namedStyle: FdnNamedStyle | undefined = node.styleRef
    ? ctx.doc.namedStyles.find((s) => s.name === node.styleRef)
    : undefined
  if (node.styleRef && !namedStyle) {
    pushReport(ctx, { code: 'unknown-style-ref', severity: 'warning', message: `named style "${node.styleRef}" is not declared`, nodeId: node.id })
  }

  const mergedRaw = namedStyle ? mergeStyles(namedStyle.style, node.style) : node.style
  const style = mapStyleValues(mergedRaw, (prop, raw) => {
    const { value, reports } = interpolateString(raw, ctx, node.id)
    ctx.reports.push(...reports)
    if (/\bstate\s*\.\s*name\b/.test(raw) && reports.some(report => report.severity === 'error')) return undefined
    auditStyleValue(prop, value, ctx, node.id)
    return value
  })
  if (node.styleRef) attrs['data-fdn-style'] = node.styleRef

  const styleStates: Partial<Record<StateStyleKey, Record<string, string>>> = {}
  for (const key of STATE_STYLE_KEYS) {
    const base = namedStyle?.styleStates?.[key]
    const own = node.styleStates?.[key]
    if (!base && !own) continue
    const merged = mergeStyles(base ?? {}, own ?? {})
    const propNames = styleEntries(merged).map(([prop]) => prop)
    if (propNames.length === 0) continue
    const parts: string[] = []
    const resolved = mapStyleValues(merged, (propName, raw) => {
      const { value, reports } = interpolateString(raw, ctx, node.id)
      ctx.reports.push(...reports)
      if (/\bstate\s*\.\s*name\b/.test(raw) && reports.some(report => report.severity === 'error')) return undefined
      parts.push(`${propName}:${value}`)
      auditStyleValue(propName, value, ctx, node.id)
      return value
    })
    if (!Object.keys(resolved).length) continue
    styleStates[key] = resolved
    attrs[`style-${key}`] = parts.join(';')
  }

  if (ctx.materialization && node.styleRef && namedStyle) {
    if ([...Object.values(namedStyle.style), ...Object.values(namedStyle.styleStates).flatMap((plane) => Object.values(plane ?? {}))].some((value) => value.includes('{{'))) throw new Error("Can't detach: this named style has dynamic values that cannot stay linked while freezing the outer state")
    const own = (plane: Record<string, string>) => mapStyleValues(plane, (_prop, raw) => interpolateString(raw, ctx, node.id).value)
    return { attrs, style: own(node.style), styleStates: Object.fromEntries(Object.entries(node.styleStates).filter(([, plane]) => plane).map(([key, plane]) => [key, own(plane!)])) }
  }
  return { attrs, style, styleStates }
}

function buildRegularNode(node: FdnNode, ctx: BakeCtx): FdnNode {
  const { attrs, style, styleStates } = resolveNodeStyle(node, ctx)
  const children = node.children.flatMap((c) => bakeNode(c, ctx))

  let text: string | undefined
  if (node.children.length === 0 && node.text !== undefined) {
    const r = interpolateString(node.text, ctx, node.id)
    ctx.reports.push(...r.reports)
    text = r.value
  }

  const overrideMark = markOverrides(node, ctx)
  if (ctx.componentOverrides?.literalText.has(node.id)) {
    text = ctx.componentOverrides.literalText.get(node.id)
    if (/\{\{\s*prop\./.test(node.text ?? '')) {
      const record = ctx.componentOverrides.marks.get(node.id)?.records.find((entry) => Object.hasOwn(entry.origin.node.attrs, 'text'))
      pushReport(ctx, { code: 'override-shadows-prop', severity: 'info', message: 'literal text override shadows the definition prop binding', nodeId: record?.origin.node.id ?? node.id })
    }
  }
  const built: FdnNode = {
    ...(ctx.materialization && node.styleRef ? { styleRef: node.styleRef } : {}),
    id: node.id,
    tag: node.tag,
    attrs: ctx.editor ? { ...attrs, ...overrideMark, 'data-fdn-id': ctx.editor.idPrefix + node.id } : attrs,
    style,
    styleStates,
    text,
    children,
  }
  if (ctx.preserveSourceIds) ctx.materialization?.preserved.add(built)
  return built
}

function markOverrides(node: FdnNode, ctx: BakeCtx): Record<string, string> {
  const mark = ctx.componentOverrides?.marks.get(node.id)
  if (!mark) return {}
  for (const record of mark.records) ctx.usedOverrides.add(record.origin)
  return ctx.editor ? { 'data-fdn-overrides': [...mark.fields].sort().join(',') } : {}
}

function editorIdentity(node: FdnNode, componentName: string, ctx: BakeCtx): Record<string, string> {
  return ctx.editor ? { ...markOverrides(node, ctx), 'data-fdn-id': ctx.editor.idPrefix + node.id, 'data-fdn-component': componentName, ...(node.attrs['component-set'] ? { 'data-fdn-component-set': node.attrs['component-set'] } : {}) } : {}
}

function withEditorIds(nodes: FdnNode[], prefix: string): FdnNode[] {
  return nodes.map((n) => ({ ...n, attrs: { ...n.attrs, 'data-fdn-id': prefix + n.id }, children: withEditorIds(n.children, prefix) }))
}

// ——— component instantiation ———

function coercePropValue(raw: string, type: FdnParamType, ctx: BakeCtx, nodeId: NodeId): unknown {
  switch (type) {
    case 'string':
    case 'enum':
    case 'token':
      return raw
    case 'boolean':
      return raw === 'true'
    case 'number': {
      const n = Number(raw)
      return Number.isNaN(n) ? raw : n
    }
    case 'list':
    case 'record':
      try {
        return JSON.parse(raw)
      } catch {
        pushReport(ctx, { code: 'invalid-list-prop', severity: 'error', message: `prop value "${raw}" is not valid JSON for a ${type} prop`, nodeId })
        return type === 'list' ? [] : {}
      }
    default:
      return raw
  }
}

function stringifyPropValue(value: unknown, type: FdnParamType): string {
  if (type === 'boolean') return value ? 'true' : 'false'
  if (type === 'list' || type === 'record') {
    try {
      return JSON.stringify(value)
    } catch {
      return '[]'
    }
  }
  return stringifyValue(value)
}

/**
 * Sealed capsule instantiation (SPEC D3/Q3, API.md Wave 4 "Bake" line):
 * `<div class="fdn-capsule-<name>">` wrapping the parsed sealed html, plus
 * its naive-prefixed css collected for the document's <style> block
 * (bake/capsule.ts, wired through emitHtml via ctx.capsuleCss).
 *
 * Deliberately minimal, matching API.md's literal wrapper shape: unlike the
 * native path, the fdn-use instance's own attrs/style/props are NOT merged
 * onto the wrapper (unresolved `when`/`each` on the instance are still
 * honored — those are evaluated by the generic bakeSingle dispatch before
 * this function is ever reached). A sealed body has no template to bind
 * props into, so props bound at the fdn-use site remain structurally legal
 * (validate still type-checks them) but are inert at bake time — the capsule
 * always renders its one fixed baseline. Recorded contract finding, not a
 * bug: sealing trades prop-driven variation for opacity.
 */
function instantiateSealedComponent(
  node: FdnNode,
  componentName: string,
  sealed: { html: string; css: string },
  ctx: BakeCtx,
): FdnNode[] {
  const capsuleClass = capsuleClassName(componentName)
  const instance: InstanceStyle | null = hasInstanceStyle(node) ? resolveNodeStyle(node, ctx) : null
  const parsed = parseSealedFragment(sealed.html, `${node.id}~cap`)
  const roots = ctx.editor ? withEditorIds(parsed, ctx.editor.idPrefix) : parsed
  if (sealed.css.trim() !== '' && !ctx.capsuleCss.has(capsuleClass)) {
    ctx.capsuleCss.set(capsuleClass, scopeCss(sealed.css, capsuleClass))
  }
  const capsule: FdnNode = {
    id: node.id,
    tag: 'div',
    attrs: { class: capsuleClass, ...Object.fromEntries(Object.entries(node.attrs).filter(([key]) => key.startsWith('data-fdn-mode-'))), ...editorIdentity(node, componentName, ctx) },
    style: {},
    styleStates: {},
    text: undefined,
    children: roots,
  }
  return [instance ? withInstanceStyle(capsule, instance) : capsule]
}

interface InstanceStyle {
  style: Record<string, string>
  styleStates: Partial<Record<StateStyleKey, Record<string, string>>>
}

function hasInstanceStyle(node: FdnNode): boolean {
  return Boolean(node.styleRef) || Object.keys(node.style).length > 0 || Object.values(node.styleStates).some((plane) => plane && Object.keys(plane).length > 0)
}

function withInstanceStyle(root: FdnNode, instance: InstanceStyle, preserveUses = false): FdnNode {
  if (root.tag === 'fdn-use' && !preserveUses) {
    return { ...root, style: { display: 'contents' }, children: root.children.map((child) => withInstanceStyle(child, instance)) }
  }
  const attrs = { ...root.attrs }
  const styleStates: Partial<Record<StateStyleKey, Record<string, string>>> = { ...root.styleStates }
  for (const key of STATE_STYLE_KEYS) {
    const merged = mergeStyles(root.styleStates[key] ?? {}, instance.styleStates[key] ?? {})
    const props = styleEntries(merged).map(([prop]) => prop)
    if (props.length === 0) continue
    styleStates[key] = merged
    attrs[`style-${key}`] = props.map((prop) => `${prop}:${merged[prop]}`).join(';')
  }
  return { ...root, attrs, style: mergeStyles(root.style, instance.style), styleStates }
}

function applyInstanceStyle(node: FdnNode, componentName: string, roots: FdnNode[], instance: InstanceStyle, ctx: BakeCtx): FdnNode[] {
  if (roots.length === 0) {
    pushReport(ctx, {
      code: 'instance-style-unapplied',
      severity: 'warning',
      message: `instance "${node.id}" of "${componentName}" has style, but the component rendered no element to carry it`,
      nodeId: node.id,
    })
  } else if (roots.length > 1) {
    pushReport(ctx, {
      code: 'instance-style-multi-root',
      severity: 'warning',
      message: `instance "${node.id}" style was applied to each of the ${roots.length} root elements of "${componentName}"`,
      nodeId: node.id,
      detail: { roots: roots.length },
    })
  }
  return roots.map((root) => {
    const next = withInstanceStyle(root, instance, ctx.materialization?.mode === 'one-level')
    if (ctx.materialization?.preserved.has(root)) ctx.materialization.preserved.add(next)
    return next
  })
}

function instantiateComponent(node: FdnNode, ctx: BakeCtx): FdnNode[] {
  let selected: ReturnType<typeof componentSelection> | undefined
  if (node.attrs['component-set']) {
    try {
      if (ctx.invalidComponentSets.has(node.attrs['component-set'])) throw new Error(`component set "${node.attrs['component-set']}" has invalid declarations`)
      selected = componentSelection(ctx.doc, node)
    } catch (err) {
      pushReport(ctx, { code: 'invalid-instance-variant', severity: 'error', message: err instanceof Error ? err.message : String(err), nodeId: node.id })
      return []
    }
  }
  const componentName = selected?.component.name ?? node.attrs['component']
  if (!componentName) {
    pushReport(ctx, { code: 'component-not-found', severity: 'error', message: 'fdn-use is missing its component="…" attribute', nodeId: node.id })
    return []
  }
  const component: FdnComponent | undefined = ctx.doc.components.find((c) => c.name === componentName)
  if (!component) {
    pushReport(ctx, { code: 'component-not-found', severity: 'error', message: `component "${componentName}" is not declared`, nodeId: node.id })
    return []
  }
  if (ctx.componentStack.includes(componentName)) {
    pushReport(ctx, {
      code: 'component-cycle',
      severity: 'error',
      message: `component "${componentName}" recurses into itself (stack: ${[...ctx.componentStack, componentName].join(' -> ')}); rendering nothing for the inner recurrence`,
      nodeId: node.id,
    })
    return []
  }

  markOverrides(node, ctx)
  const owner = [...ctx.instancePath, node.id].join('::')
  const owned = ownOverrides(node, owner)
  const inherited = ctx.componentOverrides?.nested.get(node.id) ?? []
  const records = [...owned, ...inherited]
  const duplicateTargets = new Set<string>()
  for (const record of owned) {
    const target = JSON.stringify(record.target)
    if (duplicateTargets.has(target)) pushReport(ctx, { code: 'duplicate-override-target', severity: 'warning', message: `multiple overrides target ${target} on "${owner}"; later child declarations win per property`, nodeId: record.origin.node.id })
    duplicateTargets.add(target)
  }
  for (const metadata of node.children.filter((child) => child.tag === 'fdn-override')) {
    if (!overrideTarget(metadata)) pushReport(ctx, { code: 'invalid-instance-override', severity: 'error', message: 'override target must be a nonempty JSON array of definition identities', nodeId: metadata.id })
    for (const [prop, value] of Object.entries(metadata.style)) auditStyleValue(prop, value, ctx, metadata.id)
    for (const plane of Object.values(metadata.styleStates)) if (plane) for (const [prop, value] of Object.entries(plane)) auditStyleValue(prop, value, ctx, metadata.id)
  }
  const reportDormant = () => {
    for (const record of owned) if (!ctx.usedOverrides.has(record.origin)) pushReport(ctx, { code: 'override-dormant', severity: record.origin.reason === 'target is not rendered in the current state or slot content' ? 'info' : 'warning', message: `override ${JSON.stringify(record.origin.target)} on "${owner}" is dormant: ${record.origin.reason}`, nodeId: record.origin.node.id, detail: { instanceId: node.id, instancePath: owner, target: record.origin.target } })
  }
  if (component.sealed) {
    if (ctx.materialization) throw new Error("Can't detach: sealed components have no editable native layers")
    for (const record of records) record.origin.reason = 'sealed components have no addressable inner layers'
    reportDormant()
    return instantiateSealedComponent(node, componentName, component.sealed, ctx)
  }
  const prepared = records.length ? prepareOverrides(component, records) : undefined
  if (prepared) ctx.reports.push(...prepared.reports)

  const resolved = resolveNodeStyle(node, ctx)
  const instance: InstanceStyle | null = hasInstanceStyle(node) ? resolved : null
  const bakedAttrs = Object.fromEntries(Object.entries(resolved.attrs).filter(([key]) => key !== 'data-fdn-style' && !key.startsWith('style-')))

  const propsRaw: Record<string, string> = {}
  for (const [k, v] of Object.entries(bakedAttrs)) {
    if (k.startsWith('data-fdn-prop-')) {
      propsRaw[k.slice('data-fdn-prop-'.length)] = v
    }
  }

  if (selected) for (const name of Object.keys(propsRaw)) {
    if (!component.props.some((prop) => prop.name === name)) pushReport(ctx, { code: 'instance-prop-inert', severity: 'info', message: `prop "${name}" is not declared by selected variant "${componentName}"; binding retained`, nodeId: node.id })
  }
  const propsTyped: Record<string, unknown> = {}
  const finalAttrs: Record<string, string> = { ...bakedAttrs, ...(selected ? {} : { component: componentName }), ...editorIdentity(node, componentName, ctx) }
  for (const propDef of component.props) {
    const raw = propsRaw[propDef.name]
    if (raw === undefined) {
      if (propDef.default !== undefined) {
        propsTyped[propDef.name] = propDef.default
      } else {
        propsTyped[propDef.name] = ''
        // Only a REQUIRED prop with no bound value and no default is a real
        // problem (round 3: an optional prop baking empty is its declared
        // contract, not something worth a report line).
        if (propDef.required) {
          pushReport(ctx, {
            code: 'prop-missing-default',
            severity: 'warning',
            message: `prop "${propDef.name}" on component "${componentName}" is required but has no bound value and no default; baked empty`,
            nodeId: node.id,
          })
        }
      }
    } else {
      propsTyped[propDef.name] = coercePropValue(raw, propDef.type, ctx, node.id)
    }
    finalAttrs[`data-fdn-prop-${propDef.name}`] = stringifyPropValue(propsTyped[propDef.name], propDef.type)
  }

  const nestedMaterialization = ctx.materialization ? { ...ctx.materialization, mode: 'preserve-uses' as const } : undefined
  const fillCtx = nestedMaterialization ? { ...ctx, materialization: nestedMaterialization, preserveSourceIds: true } : ctx
  const slotFills: Record<string, FdnNode[]> = {}
  for (const child of node.children) {
    if (child.tag === 'fdn-fill' && matchesStateScope(child, ctx.selectedState)) {
      const slotName = child.attrs['slot'] ?? 'default'
      const baked = child.children.flatMap((c) => bakeNode(c, fillCtx))
      slotFills[slotName] = (slotFills[slotName] ?? []).concat(baked)
    }
  }

  const innerCtx: BakeCtx = {
    ...ctx,
    ...(nestedMaterialization ? { materialization: nestedMaterialization, preserveSourceIds: false } : {}),
    bindings: { prop: propsTyped, param: ctx.bindings['param'] ?? {}, state: ctx.bindings['state'] ?? { name: ctx.selectedState ?? '' } },
    componentStack: [...ctx.componentStack, componentName],
    instancePath: [...ctx.instancePath, node.id],
    componentOverrides: prepared,
    slotFills,
    ...(ctx.editor ? { editor: { idPrefix: `${ctx.editor.idPrefix}${node.id}::` } } : {}),
  }

  const bakedBody = (prepared?.body ?? component.body).flatMap((n) => bakeNode(n, innerCtx))
  reportDormant()
  const styledBody = instance ? applyInstanceStyle(node, componentName, bakedBody, instance, ctx) : bakedBody
  const namespacedBody = prefixIds(styledBody, node.id, ctx.materialization?.preserved)

  return [
    {
      id: node.id,
      tag: node.tag,
      attrs: finalAttrs,
      style: { display: 'contents' },
      styleStates: {},
      text: undefined,
      children: namespacedBody,
    },
  ]
}

function resolveSlot(node: FdnNode, ctx: BakeCtx): FdnNode[] {
  const name = node.attrs['name'] ?? 'default'
  const fill = ctx.slotFills?.[name]
  if (fill && fill.length > 0) return fill
  return node.children.flatMap((c) => bakeNode(c, ctx))
}

function preserveInstance(node: FdnNode, ctx: BakeCtx): FdnNode[] {
  componentSelection(ctx.doc, node)
  markOverrides(node, ctx)
  const resolved = resolveNodeStyle(node, ctx)
  const attrs = Object.fromEntries(Object.entries(resolved.attrs).filter(([key]) => key !== 'data-fdn-style' && !key.startsWith('style-')))
  componentSelection(ctx.doc, { attrs })
  for (const [key, value] of Object.entries(node.attrs)) if (key === 'component' || key === 'component-set' || key.startsWith('data-fdn-variant-')) attrs[key] = value
  const inherited = ctx.componentOverrides?.nested.get(node.id) ?? []
  const owned = node.children.filter((child) => child.tag === 'fdn-override')
  const metadata = [...owned, ...inherited.map((record) => ({ ...record.origin.node, attrs: { ...record.origin.node.attrs, target: JSON.stringify(record.target) } }))]
  const template: FdnNode = { id: node.id, tag: 'fdn-use', ...(node.styleRef ? { styleRef: node.styleRef } : {}), attrs, style: resolved.style, styleStates: resolved.styleStates, children: metadata }
  const kept = metadata.filter((record) => {
    const target = overrideTarget(record)
    const exists = target && resolveOverrideTarget(ctx.doc, template, target)
    if (!exists) ctx.materialization?.dropped.add(record.id)
    return !!exists
  })
  for (const record of inherited) if (kept.some((entry) => entry.id === record.origin.node.id)) ctx.usedOverrides.add(record.origin)
  const fills = node.children.filter((child) => child.tag === 'fdn-fill').flatMap((child) => {
    if (!matchesStateScope(child, ctx.selectedState)) return []
    const fill: FdnNode = { ...child, attrs: { ...child.attrs }, children: child.children.flatMap((item) => bakeNode(item, ctx)) }
    if (ctx.preserveSourceIds) ctx.materialization?.preserved.add(fill)
    return [fill]
  })
  const result = { ...template, children: [...fills, ...kept] }
  if (ctx.preserveSourceIds) ctx.materialization?.preserved.add(result)
  return [result]
}

export function materializeInstanceTree(doc: FdnDocument, instance: FdnNode, state: string | null): { tree: FdnNode[]; report: ConformanceReport; preservedIds: Set<string>; droppedOverrides: string[] } {
  if (state !== null && !doc.states.some((item) => item.name === state)) throw new Error(`Can't detach: state "${state}" is not declared`)
  const selected = componentSelection(doc, instance).component
  if (selected.sealed) throw new Error("Can't detach: sealed components have no editable native layers")
  const materialization: Materialization = { mode: 'one-level', state, preserved: new Set(), dropped: new Set() }
  const { tree, report } = bakeTree({ ...doc, body: [instance] }, state, false, materialization)
  const error = report.lines.find((line) => line.severity === 'error')
  if (error) throw new Error(`Can't detach: ${error.message}`)
  if (!tree.length || tree.every((node) => node.tag === 'fdn-use' && !node.children.length)) throw new Error("Can't detach: this instance has no active content in the selected state")
  for (const line of report.lines) if (line.code === 'override-dormant' && line.nodeId) materialization.dropped.add(line.nodeId)
  const preservedIds = new Set<string>()
  const walk = (nodes: FdnNode[]) => { for (const node of nodes) { if (materialization.preserved.has(node)) preservedIds.add(node.id); walk(node.children) } }
  walk(tree)
  return { tree, report, preservedIds, droppedOverrides: [...materialization.dropped] }
}
