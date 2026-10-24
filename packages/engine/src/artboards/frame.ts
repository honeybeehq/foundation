import type { FdnDocument, FdnNode, PatchOp, ReportLine } from '../types.js'
import { stateContext } from '../bake/context.js'
import { resolveNodeStyle } from '../bake/node-style.js'
import { tokenValueCss } from '../tokens/index.js'
import { styleEntries } from '../bake/styles.js'

export const ARTBOARD_FRAME_VERSION = '0.2.0-artboard-frames'
const sides = ['top', 'right', 'bottom', 'left'] as const
const geometry = /^(?:all|(?:min-|max-)?(?:width|height|inline-size|block-size)|margin(?:-.+)?|inset(?:-.+)?|top|right|bottom|left|aspect-ratio|transform(?:-.+)?|translate|rotate|scale|zoom)$/
const overflow = (key: string) => /^overflow(?:-[xy])?$/.test(key.toLowerCase())

export function hasArtboardFrame(node: FdnNode): boolean {
  return node.styleRef !== undefined || Object.keys(node.style).length > 0 || Object.values(node.styleStates).some(plane => plane && Object.keys(plane).length) || Object.keys(node.attrs).some(key => key.startsWith('data-fdn-mode-') || key === 'data-fdn-layout' || !key.startsWith('data-fdn-'))
}

export function artboardFrameIssues(doc: FdnDocument, node: FdnNode): ReportLine[] {
  const issues: ReportLine[] = []
  const named = doc.namedStyles.find(style => style.name === node.styleRef)
  const issue = (code: string, message: string, property: string) => issues.push({ code, message, severity: 'error', nodeId: node.id, detail: { property } })
  for (const key of Object.keys(node.attrs)) if (/^(?:style(?:-.+)?|data-fdn-style)$/i.test(key)) issue('artboard-frame-conflict', 'frame styles and bindings must use their canonical node fields', key)
  for (const plane of [node.style, ...Object.values(node.styleStates), named?.style, ...Object.values(named?.styleStates ?? {})]) {
    for (const [key, value] of Object.entries(plane ?? {})) {
      if ((!key.startsWith('--') && !/^[a-z-]+$/.test(key)) || geometry.test(key.toLowerCase()) || key === 'position' && value !== 'relative' || key === 'box-sizing' && value !== 'border-box' || key === 'display' && !['block', 'flex', 'grid'].includes(value)) issue('artboard-frame-geometry', `artboard ${key} is owned by its literal viewport and canvas geometry; use artboard sizing and placement operations`, key)
    }
  }
  for (const side of sides) if (node.attrs[`data-fdn-padding-${side}`] !== undefined && (node.style[`padding-${side}`] !== undefined || node.style.padding !== undefined)) issue('artboard-frame-conflict', 'legacy padding and authored frame padding both exist; repair the source before migration', `padding-${side}`)
  if (node.attrs['data-fdn-overflow'] !== undefined && [node.style, ...Object.values(node.styleStates)].some(plane => Object.keys(plane ?? {}).some(overflow))) issue('artboard-frame-conflict', 'legacy capture overflow and authored frame overflow both exist; repair the source before migration', 'overflow')
  return issues
}

export function artboardFrameNode(node: FdnNode): FdnNode {
  const fallback = Object.fromEntries(sides.flatMap(side => {
    const value = node.attrs[`data-fdn-padding-${side}`]
    return value === undefined || node.style.padding !== undefined ? [] : [[`padding-${side}`, `${Number(value)}px`]]
  }))
  const attrs = Object.fromEntries(Object.entries(node.attrs).filter(([key]) => !/^data-fdn-(?:name|x|y|width|height|overflow|frame|visible|padding-.+|view-.+)$/.test(key)))
  return { ...node, tag: 'body', attrs, style: { ...fallback, ...node.style }, children: node.children.filter(child => child.tag !== 'fdn-artboard-view') }
}

export function filterFrameOverflow(source: FdnNode, resolved: ReturnType<typeof resolveNodeStyle>): void {
  if (source.attrs['data-fdn-overflow'] === undefined) return
  for (const key of Object.keys(resolved.style)) if (overflow(key)) delete resolved.style[key]
  for (const [state, plane] of Object.entries(resolved.styleStates)) {
    if (!plane) continue
    for (const key of Object.keys(plane)) if (overflow(key)) delete plane[key]
    const declarations = Object.entries(plane).map(([key, value]) => `${key}:${value}`).join(';')
    if (declarations) resolved.attrs[`style-${state}`] = declarations
    else delete resolved.attrs[`style-${state}`]
  }
}

function resolveCssValue(value: string, variable: (name: string) => string | undefined): string | undefined {
  const start = value.indexOf('var(')
  if (start === -1) return value
  let depth = 1, end = start + 4, comma = -1
  for (; end < value.length && depth > 0; end++) {
    const char = value[end]
    if (char === '(') depth++
    if (char === ')') depth--
    if (char === ',' && depth === 1 && comma === -1) comma = end
  }
  if (depth !== 0) return undefined
  const name = value.slice(start + 4, comma === -1 ? end - 1 : comma).trim()
  if (!/^--[\w-]+$/.test(name)) return undefined
  const replacement = variable(name) ?? (comma === -1 ? undefined : resolveCssValue(value.slice(comma + 1, end - 1), variable))
  return replacement === undefined ? undefined : resolveCssValue(value.slice(0, start) + replacement + value.slice(end), variable)
}

function resolveCssVariables(declarations: Record<string, string>, inherited: Record<string, string> = {}): Record<string, string> {
  const active: string[] = [], cyclic = new Set<string>(), cached = new Map<string, string | undefined>()
  const variable = (name: string): string | undefined => {
    const cycle = active.indexOf(name)
    if (cycle !== -1) { active.slice(cycle).forEach(key => cyclic.add(key)); return undefined }
    if (cached.has(name)) return cached.get(name)
    if (!Object.hasOwn(declarations, name)) return inherited[name]
    active.push(name)
    const raw = declarations[name]!.trim()
    const resolved = raw === 'initial' ? undefined : ['inherit', 'unset', 'revert', 'revert-layer'].includes(raw) ? inherited[name] : resolveCssValue(raw, variable)
    active.pop()
    const value = cyclic.has(name) ? undefined : resolved
    cached.set(name, value)
    return value
  }
  const resolved = { ...inherited }
  for (const name of Object.keys(declarations)) {
    const value = variable(name)
    if (value === undefined) delete resolved[name]
    else resolved[name] = value
  }
  return resolved
}

export function artboardOverflow(doc: FdnDocument, node: FdnNode, state: string | null): 'clip' | 'visible' {
  const legacy = node.attrs['data-fdn-overflow']
  if (legacy !== undefined) return legacy === 'clip' ? 'clip' : 'visible'
  const resolved = resolveNodeStyle(artboardFrameNode(node), doc, stateContext(doc, state), [])
  const defaults = { ...doc.tokens }, scoped: Record<string, string> = {}
  if (doc.tokenCollections?.length) for (const [name, value] of Object.entries(doc.tokens)) if (value.includes('var(')) scoped[name] = value
  for (const collection of doc.tokenCollections ?? []) {
    const mode = node.attrs[`data-fdn-mode-${collection.name}`] ?? collection.modes[0]!
    for (const token of collection.tokens) {
      defaults[token.name] = tokenValueCss(token.values[collection.modes[0]!]!, token.type)
      const value = token.values[mode]
      if (value !== undefined) scoped[token.name] = tokenValueCss(value, token.type)
    }
  }
  for (const [key, value] of Object.entries(resolved.style)) if (key.startsWith('--')) scoped[key.slice(2)] = value
  const tokens = resolveCssVariables(Object.fromEntries(Object.entries(scoped).map(([key, value]) => [`--${key}`, value])), resolveCssVariables(Object.fromEntries(Object.entries(defaults).map(([key, value]) => [`--${key}`, value]))))
  let x = 'visible', y = 'visible'
  for (const [key, raw] of styleEntries(resolved.style)) {
    if (!overflow(key)) continue
    const value = resolveCssValue(raw, name => tokens[name])?.trim()
    const parts = value?.split(/\s+/) ?? ['clip']
    if (parts.length === 1 && ['initial', 'unset', 'revert', 'revert-layer', 'inherit'].includes(parts[0]!)) parts[0] = parts[0] === 'inherit' ? 'auto' : 'visible'
    if (parts.length > (key === 'overflow' ? 2 : 1) || parts.some(part => !['hidden', 'clip', 'auto', 'scroll', 'visible'].includes(part))) continue
    if (key === 'overflow' || key === 'overflow-x') x = parts[0]!
    if (key === 'overflow' || key === 'overflow-y') y = parts[1] ?? parts[0]!
  }
  return [x, y].some(value => value !== 'visible') ? 'clip' : 'visible'
}

export function promoteArtboardFrame(doc: FdnDocument, node: FdnNode): PatchOp[] {
  const issues = artboardFrameIssues(doc, node).filter(issue => issue.code === 'artboard-frame-conflict')
  if (issues.length) throw new Error(issues[0]!.message)
  const ops: PatchOp[] = doc.specVersion === ARTBOARD_FRAME_VERSION ? [] : [{ op: 'set-spec-version', specVersion: ARTBOARD_FRAME_VERSION }]
  for (const side of sides) {
    const key = `data-fdn-padding-${side}`, value = node.attrs[key]
    if (value === undefined) continue
    ops.push({ op: 'set-style', id: node.id, prop: `padding-${side}`, value: `${Number(value)}px` }, { op: 'set-attr', id: node.id, key, value: null })
  }
  return ops
}
