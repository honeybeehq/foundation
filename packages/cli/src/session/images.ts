import { applyPatch, diffPatch, imageNodes, imageSources, importImage } from 'foundation-engine'
import type { FdnDocument, FdnNode, PatchOp } from 'foundation-engine'
import type { ImageImportResult, SessionOp } from 'foundation-protocol'
import { expandSessionOps } from './token-modes.js'

export function hasImageOperations(ops: SessionOp[]): boolean {
  return ops.some(op => op.op === 'import-image' || op.op === 'localize-images')
}

export async function prepareImageOperations(doc: FdnDocument, ops: SessionOp[], path: string): Promise<{ ops: PatchOp[]; images: ImageImportResult[] }> {
  let target = structuredClone(doc)
  const images: ImageImportResult[] = []
  const store = async (node: FdnNode, property: 'src' | 'background-image' | 'background', source: string) => {
    try {
      const asset = await importImage(path, source)
      if (property === 'src') node.attrs.src = asset.src
      else if (node.style[property]?.includes(source)) node.style[property] = node.style[property]!.replace(source, asset.src)
      else node.style[property] = `url("${asset.src}")`
      if (/^https?:\/\//i.test(source)) node.attrs['data-fdn-source-url'] = source
      else delete node.attrs['data-fdn-source-url']
      images.push({ nodeId: node.id, property, source, status: 'stored', asset })
    } catch (err) { images.push({ nodeId: node.id, property, source, status: 'failed', reason: err instanceof Error ? err.message : String(err) }) }
  }
  for (const op of ops) {
    if (op.op === 'import-image') {
      const node = imageNodes(target).find(node => node.id === op.id)
      if (!node) throw new Error(`unknown image node: ${op.id}`)
      if ((op.property ?? 'src') === 'src' && node.tag !== 'img') throw new Error('src image import requires an img node')
      await store(node, op.property ?? 'src', op.source)
    } else if (op.op === 'localize-images') {
      const nodes = imageNodes(target)
      if (op.nodeIds?.some(id => !nodes.some(node => node.id === id))) throw new Error('unknown node in localize-images')
      const selected = new Set<string>()
      const walk = (node: FdnNode) => { selected.add(node.id); node.children.forEach(walk) }
      for (const node of nodes) if (!op.nodeIds || op.nodeIds.includes(node.id)) walk(node)
      for (const node of nodes) if (selected.has(node.id)) for (const image of imageSources(node)) {
        if (/^https?:\/\//i.test(image.src)) await store(node, image.property as 'src' | 'background-image' | 'background', image.src)
      }
    } else {
      const patch = applyPatch(target, expandSessionOps(target, [op]))
      if (!patch.ok) throw new Error(patch.error.message)
      target = patch.doc
    }
  }
  const patch = diffPatch(doc, target)
  if (patch === null) throw new Error('image edit cannot be expressed as granular changes')
  return { ops: patch, images }
}
