import type { FdnDocument, FdnNode, PatchOp } from '../../engine/src/types.js'

/** The small editable vocabulary in the desktop study, projected from FdnDocument. */
export interface DesignNode {
  id: string
  name: string
  board: 'desktop' | 'mobile'
  type: 'text' | 'image' | 'component' | 'shape'
  x: number; y: number; w: number; h: number
  opacity: number; radius: number
  text?: string; font?: string; weight?: string
  fontSize?: number; lineHeight?: number; tracking?: number
  token?: string; color?: string; asset?: string
}
export interface DesignModel { tokens: Record<string, string>; nodes: DesignNode[] }

const geometry = { x: 'left', y: 'top', w: 'width', h: 'height', radius: 'border-radius', fontSize: 'font-size', tracking: 'letter-spacing' } as const
const fonts: Record<string, string> = { sans: '"Helvetica Neue",Arial,sans-serif', serif: 'Georgia,serif', mono: 'Menlo,monospace' }

export function toFdnNode(node: DesignNode): FdnNode {
  const style: Record<string, string> = { position: 'absolute', opacity: String(node.opacity / 100) }
  for (const [key, prop] of Object.entries(geometry)) {
    const value = node[key as keyof typeof geometry]
    if (value !== undefined) style[prop] = `${value}px`
  }
  if (node.font) style['font-family'] = fonts[node.font] ?? fonts.sans!
  if (node.weight) style['font-weight'] = node.weight
  if (node.lineHeight !== undefined) style['line-height'] = String(node.lineHeight)
  if (node.type !== 'image') style[node.type === 'text' ? 'color' : 'background-color'] = node.color ?? `var(--${node.token ?? 'sage'})`
  if (node.asset) style['background-image'] = `url("${node.asset}")`
  return {
    id: node.id, tag: 'div',
    attrs: { 'data-design-name': node.name, 'data-design-type': node.type },
    style, styleStates: {}, children: [], ...(node.text !== undefined ? { text: node.text } : {}),
  }
}

export function seedDocument(model: DesignModel, photoAsset: string): FdnDocument {
  if (!/^assets\/[a-zA-Z0-9._-]+$/.test(photoAsset)) throw new Error('Seed image must reference a bundled asset')
  return {
    specVersion: '0.1', title: 'Somewhere', tokens: { ...model.tokens },
    params: [], data: [], lookups: [], states: [], viewports: [], matrix: [], namedStyles: [], components: [], annotations: [],
    body: (['desktop', 'mobile'] as const).map(board => ({
      id: `${board}-board`, tag: 'fdn-overlay', attrs: { 'data-design-board': board },
      style: { position: 'relative', width: board === 'desktop' ? '900px' : '280px', height: board === 'desktop' ? '735px' : '595px', 'background-color': 'var(--paper)' },
      styleStates: {}, children: model.nodes.filter(n => n.board === board).map(n => toFdnNode(n.type === 'image' ? { ...n, asset: photoAsset } : n)),
    })),
  }
}

export function fromDocument(doc: FdnDocument): DesignModel {
  const nodes: DesignNode[] = []
  for (const root of doc.body) {
    const board = root.attrs['data-design-board']
    if (board !== 'desktop' && board !== 'mobile') continue
    for (const n of root.children) {
      const type = n.attrs['data-design-type']
      if (type !== 'text' && type !== 'image' && type !== 'component' && type !== 'shape') continue
      const number = (prop: string, fallback: number) => { const value = Number.parseFloat(n.style[prop] ?? ''); return Number.isFinite(value) ? value : fallback }
      const color = n.style[type === 'text' ? 'color' : 'background-color']
      const token = color?.match(/^var\(--([a-zA-Z0-9_-]+)\)$/)?.[1]
      nodes.push({
        id: n.id, name: n.attrs['data-design-name'] ?? n.id, board, type,
        x: number('left', 0), y: number('top', 0), w: number('width', 100), h: number('height', 50), opacity: number('opacity', 1) * 100, radius: number('border-radius', 0),
        ...(n.text !== undefined ? { text: n.text, font: Object.entries(fonts).find(([, value]) => value === n.style['font-family'])?.[0] ?? 'sans', weight: n.style['font-weight'] ?? '400', fontSize: number('font-size', 24), lineHeight: number('line-height', 1.2), tracking: number('letter-spacing', 0) } : {}),
        ...(token ? { token } : color ? { color } : {}),
        ...(n.style['background-image']?.match(/^url\("(assets\/[a-zA-Z0-9._-]+)"\)$/)?.[1] ? { asset: n.style['background-image']!.slice(5, -2) } : {}),
      })
    }
  }
  return { tokens: { ...doc.tokens }, nodes }
}

/** Diff the gesture's before/after values, never replace the remote document. */
export function editsBetween(before: DesignModel, after: DesignModel): PatchOp[] {
  const ops: PatchOp[] = []
  for (const name of new Set([...Object.keys(before.tokens), ...Object.keys(after.tokens)])) {
    if (before.tokens[name] !== after.tokens[name]) ops.push({ op: 'set-token', name, value: after.tokens[name] ?? null })
  }
  const previous = new Map(before.nodes.map(n => [n.id, n]))
  for (const next of after.nodes) {
    const old = previous.get(next.id)
    const node = toFdnNode(next)
    if (!old) { ops.push({ op: 'insert-node', parent: `${next.board}-board`, index: after.nodes.filter(n => n.board === next.board).findIndex(n => n.id === next.id), node }); continue }
    const prior = toFdnNode(old)
    if (prior.text !== node.text && node.text !== undefined) ops.push({ op: 'set-text', id: node.id, text: node.text })
    for (const prop of new Set([...Object.keys(prior.style), ...Object.keys(node.style)])) {
      if (prior.style[prop] !== node.style[prop]) ops.push({ op: 'set-style', id: node.id, prop, value: node.style[prop] ?? null })
    }
    for (const key of Object.keys(node.attrs)) {
      if (prior.attrs[key] !== node.attrs[key]) ops.push({ op: 'set-attr', id: node.id, key, value: node.attrs[key]! })
    }
  }
  for (const old of before.nodes) if (!after.nodes.some(n => n.id === old.id)) ops.push({ op: 'remove-node', id: old.id })
  return ops
}
