import type { FdnDocument, FdnNode, PatchOp, ReportLine } from '../types.js'
import { stateContext } from '../bake/context.js'
import { resolveNodeStyle } from '../bake/node-style.js'
import { tokenValueCss } from '../tokens/index.js'

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
  const attrs = Object.fromEntries(Object.entries(node.attrs).filter(([key]) => !/^data-fdn-(?:name|x|y|width|height|overflow|frame|padding-.+)$/.test(key)))
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

export function artboardOverflow(doc: FdnDocument, node: FdnNode, state: string | null): 'clip' | 'visible' {
  const legacy = node.attrs['data-fdn-overflow']
  if (legacy !== undefined) return legacy === 'clip' ? 'clip' : 'visible'
  const resolved = resolveNodeStyle(artboardFrameNode(node), doc, stateContext(doc, state), [])
  const tokens: Record<string, string> = { ...doc.tokens }
  for (const collection of doc.tokenCollections ?? []) {
    const mode = node.attrs[`data-fdn-mode-${collection.name}`] ?? collection.modes[0]!
    for (const token of collection.tokens) {
      const value = token.values[mode]
      if (value !== undefined) tokens[token.name] = tokenValueCss(value, token.type)
    }
  }
  const expand = (value: string, active = new Set<string>()): string => value.replace(/var\(\s*--([\w-]+)\s*(?:,\s*([^()]+))?\)/g, (_, name: string, fallback: string | undefined) => active.has(name) ? '' : expand(tokens[name] ?? fallback ?? '', new Set([...active, name])))
  const values = [resolved.style.overflow, resolved.style['overflow-x'], resolved.style['overflow-y']].filter((value): value is string => value !== undefined).map(value => expand(value).trim())
  return values.some(value => value.split(/\s+/).some(part => ['hidden', 'clip', 'auto', 'scroll', 'inherit'].includes(part))) ? 'clip' : 'visible'
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
