import { styleEntries } from './styles.js'
/**
 * Small HTML emitter: resolved FdnNode tree → readable HTML string.
 * Pure, deterministic (sorted attrs/tokens/declarations) — required for the
 * "same doc+state twice → byte-identical html" contract.
 *
 * Derived output only: body content, the token :root block, and the title.
 * No fdn-doc header, no component definitions — those are template-form
 * concerns, not bake output.
 */

import { collectionCss } from '../tokens/index.js'
import type { BoardView, FdnDocument, FdnNode } from '../types.js'

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderNode(node: FdnNode, depth: number, includeNodeIds = false): string {
  const indent = '  '.repeat(depth)
  const attrParts: string[] = []
  const attrs = includeNodeIds ? { ...node.attrs, 'data-fdn-id': node.id } : node.attrs
  for (const key of Object.keys(attrs).sort()) {
    attrParts.push(`${key}="${escapeAttr(attrs[key] as string)}"`)
  }
  const declarations = styleEntries(node.style)
  if (declarations.length > 0) {
    const styleStr = declarations.map(([key, value]) => `${key}:${value}`).join(';')
    attrParts.push(`style="${escapeAttr(styleStr)}"`)
  }
  const openTag = `<${node.tag}${attrParts.length > 0 ? ' ' + attrParts.join(' ') : ''}>`

  if (VOID_ELEMENTS.has(node.tag)) return `${indent}${openTag}`

  const closeTag = `</${node.tag}>`
  const hasChildren = node.children.length > 0
  const hasText = node.text !== undefined && node.text.length > 0

  if (!hasChildren && !hasText) return `${indent}${openTag}${closeTag}`

  if (hasChildren) {
    const inner = node.children.map((c) => renderNode(c, depth + 1, includeNodeIds)).join('\n')
    return `${indent}${openTag}\n${inner}\n${indent}${closeTag}`
  }

  return `${indent}${openTag}${escapeText(node.text as string)}${closeTag}`
}

/**
 * Sealed-capsule css, collected during the bake walk (bake/index.ts,
 * bake/capsule.ts) — capsule class name -> its already-scoped css text.
 * Merged into the SAME <style> block as the :root token block (API.md: "css
 * collected into the baked document's style block", singular). Sorted by
 * capsule class name for the same determinism guarantee as the token block.
 */
export function emitHtml(doc: FdnDocument, tree: FdnNode[], capsuleCss?: Map<string, string>, artboard?: Pick<BoardView, 'height' | 'padding' | 'frame'>, includeNodeIds = false, root?: FdnNode): string {
  const lines: string[] = []
  if (artboard && artboard.frame !== 'legacy') lines.push('<!doctype html>')
  lines.push('<!-- baked by foundation-engine — derived artifact, do not edit -->')
  lines.push(...styleBlock(doc, capsuleCss, artboard, root))

  if (doc.title) {
    lines.push(`<title>${escapeText(doc.title)}</title>`)
  }

  if (root && (Object.keys(root.style).length || Object.keys(root.attrs).length)) lines.push(renderNode({ ...root, children: tree }, 0, includeNodeIds))
  else for (const node of tree) lines.push(renderNode(node, 0, includeNodeIds))

  return lines.join('\n') + '\n'
}

export function emitEditorHtml(doc: FdnDocument, tree: FdnNode[], capsuleCss?: Map<string, string>, artboard?: Pick<BoardView, 'height' | 'padding' | 'frame'>, root?: FdnNode): string {
  const lines: string[] = ['<!doctype html>', '<html>', '<head>', '<meta charset="utf-8">']
  if (doc.title) lines.push(`<title>${escapeText(doc.title)}</title>`)
  lines.push(...styleBlock(doc, capsuleCss, artboard, root), '</head>')
  if (root) lines.push(renderNode({ ...root, children: tree }, 0))
  else {
    lines.push('<body>')
    for (const node of tree) lines.push(renderNode(node, 0))
    lines.push('</body>')
  }
  lines.push('</html>')
  return lines.join('\n') + '\n'
}

function styleBlock(doc: FdnDocument, capsuleCss?: Map<string, string>, artboard?: Pick<BoardView, 'height' | 'padding' | 'frame'>, root?: FdnNode): string[] {
  const lines: string[] = []
  const tokenNames = Object.keys(doc.tokens).sort()
  const capsuleNames = capsuleCss ? [...capsuleCss.keys()].sort() : []
  const hasFrame = artboard && (artboard.frame !== 'legacy' || Object.values(artboard.padding).some(value => value !== 0))
  const authoredRoot = root && (Object.keys(root.style).length > 0 || Object.values(root.styleStates).some(plane => plane && Object.keys(plane).length) || Object.keys(root.attrs).some(key => key.startsWith('data-fdn-mode-')))
  if (!hasFrame && !authoredRoot && tokenNames.length === 0 && capsuleNames.length === 0 && !doc.tokenCollections?.length) return lines
  lines.push('<style>')
  if (authoredRoot) lines.push('html { background-image:linear-gradient(transparent,transparent);overflow:auto; }')
  if (tokenNames.length > 0) {
    lines.push(':root {')
    for (const name of tokenNames) {
      lines.push(`  --${name}: ${doc.tokens[name]};`)
    }
    lines.push('}')
  }
  lines.push(...collectionCss(doc))
  for (const name of capsuleNames) {
    lines.push(capsuleCss?.get(name) as string)
  }
  if (hasFrame) {
    const { height, padding } = artboard
    const frame = artboard.frame !== 'legacy' ? `margin:0;box-sizing:border-box;height:${height}px;` : ''
    lines.push(`body { ${frame}padding:${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px; }`)
  }
  lines.push('</style>')
  return lines
}
