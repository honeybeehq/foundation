import { mintNodeId } from '../node-id.js'
import type { FdnDocument, FdnNode, InstanceDetachReport, PatchOp } from '../types.js'
import { indexNodes } from '../chain/model.js'
import { materializeInstanceTree, bakeEditorDocument } from '../bake/index.js'
import { styleEntries } from '../bake/styles.js'
import { expandShorthand } from '../parse/style.js'
import { componentSelection } from './variants.js'

const literal = (value: string, text = false) => value.replace(text ? /[{}]| +/g : /[{}]/g, (part, offset: number) => {
  if (text && part[0] === ' ' && part.length === 1 && offset > 0 && offset + part.length < value.length) return part
  return [...part].map((character) => `{{ '${character}' }}`).join('')
})
const machinery = (key: string) => key === 'component' || key === 'component-set' || key.startsWith('data-fdn-prop-') || key.startsWith('data-fdn-variant-') || key === 'data-fdn-style' || key === 'data-fdn-state' || key.startsWith('style-') || ['data-fdn-id', 'data-fdn-component', 'data-fdn-component-set', 'data-fdn-overrides', 'data-fdn-sample', 'data-fdn-index'].includes(key)
const shorthands = new Set(['all', 'padding', 'margin', 'inset', 'border', 'border-width', 'border-style', 'border-color', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius', 'background', 'font', 'gap', 'flex', 'flex-flow', 'grid', 'grid-template', 'grid-area', 'grid-row', 'grid-column', 'outline', 'animation', 'transition', 'list-style', 'text-decoration', 'mask', 'columns', 'column-rule', 'overflow', 'place-content', 'place-items', 'place-self', 'scroll-margin', 'scroll-padding'])

function conflicts(short: string, other: string): boolean {
  if (short === 'all') return !other.startsWith('--')
  if (other.startsWith(short + '-')) return true
  if (short.startsWith('border') && other.startsWith('border-')) return true
  if (short === 'gap') return ['row-gap', 'column-gap'].includes(other)
  if (short === 'inset') return ['top', 'right', 'bottom', 'left'].includes(other)
  if (short === 'font') return other === 'line-height'
  if (short.startsWith('place-')) return other === 'align-' + short.slice(6) || other === 'justify-' + short.slice(6)
  return false
}

function storedStyle(style: Record<string, string>): Record<string, string> {
  const entries = styleEntries(style)
  for (const [prop] of entries) if (shorthands.has(prop)) for (const [other] of entries) if (other !== prop && conflicts(prop, other)) throw new Error(`Can't detach: ${prop} and ${other} have shorthand ordering that cannot be stored safely`)
  const out: Record<string, string> = {}
  for (const [prop, value] of entries) for (const [key, expanded] of Object.entries(expandShorthand(prop, value)?.longhand ?? { [prop]: value })) out[key] = literal(expanded)
  return out
}

export function detachInstance(doc: FdnDocument, id: string, state: string | null): { ops: PatchOp[]; report: InstanceDetachReport } {
  const index = indexNodes(doc.body)
  const location = index.get(id)
  if (!location || location.node.tag !== 'fdn-use') throw new Error(`Can't detach: "${id}" is not a source component instance`)
  const source = location.node
  if (source.styleRef) throw new Error("Can't detach: this instance has a placement style link that cannot be combined with native layer style links")
  const ancestors: FdnNode[] = []
  let parent = location.parent
  while (parent !== null) { const entry = index.get(parent)!; ancestors.push(entry.node); parent = entry.parent }
  if (ancestors.some((node) => node.each)) throw new Error("Can't detach: this instance is inside a repeated layer; choose a single occurrence first")
  if (state !== null && !doc.states.some((item) => item.name === state)) throw new Error(`Can't detach: state "${state}" is not declared`)
  if (state !== null && [...ancestors, source].some((node) => node.attrs['data-fdn-state'] !== undefined && node.attrs['data-fdn-state'] !== state)) throw new Error("Can't detach: this instance is not active in the selected state")
  const selected = componentSelection(doc, source).component
  if (selected.sealed) throw new Error("Can't detach: sealed components have no editable native layers")
  const scoped = (nodes: FdnNode[]): boolean => nodes.some((node) => node.tag !== 'fdn-override' && (node.attrs['data-fdn-state'] !== undefined || scoped(node.children)))
  if (state === null && (ancestors.some((node) => node.attrs['data-fdn-state'] !== undefined) || scoped([source, ...selected.body]))) throw new Error("Can't detach: choose a named state before freezing state-scoped content")
  const visible = bakeEditorDocument(doc, state === null ? undefined : { state }).tree
  const contains = (nodes: FdnNode[]): boolean => nodes.some((node) => node.attrs['data-fdn-id'] === id || contains(node.children))
  if (!contains(visible)) throw new Error("Can't detach: this instance is not active in the selected state")
  const materialized = materializeInstanceTree(doc, source, state)
  const roots = materialized.tree.length === 1 ? materialized.tree[0]!.children : materialized.tree.map((node) => ({ ...node, tag: 'div', attrs: Object.fromEntries(Object.entries(node.attrs).filter(([key]) => !machinery(key))) }))
  const wrapperAttrs = materialized.tree.length === 1 ? Object.fromEntries(Object.entries(materialized.tree[0]?.attrs ?? {}).filter(([key]) => !machinery(key))) : {}
  const semanticWrapper = Object.keys(wrapperAttrs).some((key) => key !== 'data-fdn-name')
  const single = roots.length === 1 && roots[0]!.tag !== 'fdn-use' && !materialized.preservedIds.has(roots[0]!.id) && !semanticWrapper
  if (!single && roots.some((node) => node.style.position === 'absolute')) throw new Error("Can't detach: a free instance with multiple roots or wrapper attributes needs a positioned group")
  const createdIds: string[] = [], preservedIds: string[] = []
  const allocate = () => { const next = mintNodeId(); createdIds.push(next); return next }
  const clean = (node: FdnNode, root = false): FdnNode => {
    const keep = materialized.preservedIds.has(node.id) && !preservedIds.includes(node.id)
    const nextId = root ? id : keep ? node.id : allocate()
    if (keep && !root) preservedIds.push(nextId)
    if (node.tag === 'fdn-override') return { ...structuredClone(node), id: nextId }
    if (node.text !== undefined && /[^\S ]/u.test(node.text)) throw new Error("Can't detach: this label has line breaks, tabs or nonbreaking spaces that would be lost")
    const attrs = Object.fromEntries(Object.entries(node.attrs).filter(([key]) => !machinery(key) || node.tag === 'fdn-use' && (key === 'component' || key === 'component-set' || key.startsWith('data-fdn-prop-') || key.startsWith('data-fdn-variant-'))).map(([key, value]) => [key, node.tag === 'fdn-fill' && key === 'slot' || node.tag === 'fdn-use' && (key === 'component' || key === 'component-set' || key.startsWith('data-fdn-variant-')) ? value : literal(value)]))
    const styleStates = Object.fromEntries(Object.entries(node.styleStates).filter(([, plane]) => plane).map(([key, plane]) => [key, storedStyle(plane!)]))
    return { id: nextId, tag: node.tag, ...(node.styleRef ? { styleRef: node.styleRef } : {}), attrs, style: storedStyle(node.style), styleStates, ...(node.text !== undefined ? { text: literal(node.text, true) } : {}), children: node.children.map((child) => clean(child)) }
  }
  const root: FdnNode = single ? clean(roots[0]!, true) : { id, tag: 'div', attrs: Object.fromEntries(Object.entries(wrapperAttrs).map(([key, value]) => [key, literal(value)])), style: { display: 'contents' }, styleStates: {}, children: roots.map((node) => clean(node)) }
  if (single && wrapperAttrs['data-fdn-name']) root.attrs['data-fdn-name'] = literal(wrapperAttrs['data-fdn-name'])
  return { ops: [{ op: 'remove-node', id }, { op: 'insert-node', parent: location.parent, index: location.index, node: root }], report: { instanceId: id, state, snapshot: 'chosen-state', rootId: id, createdIds, preservedIds, dormantOverridesDropped: materialized.droppedOverrides } }
}
