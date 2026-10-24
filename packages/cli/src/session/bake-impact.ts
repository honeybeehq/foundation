import { indexNodes, explicitArtboards } from 'foundation-engine'
import type { FdnDocument, PatchOp } from 'foundation-engine'

export interface BakeImpact {
  states: Set<string | null> | null
  artboards?: Set<string | null> | null
  components: boolean
}

export function mergeBakeImpact(a: BakeImpact, b: BakeImpact): BakeImpact {
  return { states: a.states && b.states ? new Set([...a.states, ...b.states]) : null, artboards: a.artboards && b.artboards ? new Set([...a.artboards, ...b.artboards]) : null, components: a.components || b.components }
}

export function bakeImpact(doc: FdnDocument, ops: PatchOp[], before = doc): BakeImpact {
  let impact: BakeImpact = { states: new Set(), artboards: new Set(), components: false }
  const oldIndex = indexNodes(before.body)
  const newIndex = indexNodes(doc.body)
  const scope = (index: ReturnType<typeof indexNodes>, id: string): BakeImpact => {
    let loc = index.get(id)
    if (!loc) return { states: null, artboards: null, components: true }
    const scopes = new Set<string>()
    let artboard: string | null = null
    while (loc) {
      if (loc.node.tag === 'fdn-artboard') artboard = loc.node.id
      const state = loc.node.attrs['data-fdn-state']
      if (state !== undefined) scopes.add(state)
      loc = loc.parent === null ? undefined : index.get(loc.parent)
    }
    return { states: scopes.size === 0 ? null : new Set([null, ...(scopes.size === 1 ? scopes : [])]), artboards: new Set([artboard]), components: false }
  }
  for (const op of ops) {
    switch (op.op) {
      case 'annotate': case 'set-annotation-status': case 'remove-annotation': case 'set-matrix': case 'set-spec-version':
        break
      case 'set-viewport': case 'remove-viewport': {
        const name = op.op === 'set-viewport' ? op.viewport.name : op.name
        if ((explicitArtboards(doc) || explicitArtboards(before)) && before.viewports.find(viewport => viewport.name === name)?.height !== doc.viewports.find(viewport => viewport.name === name)?.height) impact = mergeBakeImpact(impact, { states: null, artboards: null, components: false })
        break
      }
      case 'set-attr': case 'set-style': case 'set-style-ref': case 'set-text': case 'set-when': {
        const loc = newIndex.get(op.id) ?? oldIndex.get(op.id)
        if (op.op === 'set-attr' && ((loc?.node.tag === 'fdn-artboard' && (op.key.startsWith('data-fdn-padding-') || ['data-fdn-height', 'data-fdn-frame'].includes(op.key))) || (loc?.node.tag === 'fdn-artboard-view' && ['data-fdn-height', 'data-fdn-view-state', 'data-fdn-view-viewport'].includes(op.key)))) impact = mergeBakeImpact(impact, scope(newIndex.has(op.id) ? newIndex : oldIndex, op.id))
        if (loc && ['fdn-page', 'fdn-artboard', 'fdn-artboard-view'].includes(loc.node.tag)) break
        if (op.op === 'set-attr' && op.key === 'data-fdn-state') impact = mergeBakeImpact(impact, { states: null, artboards: scope(newIndex.has(op.id) ? newIndex : oldIndex, op.id).artboards, components: false })
        else impact = mergeBakeImpact(impact, scope(newIndex.has(op.id) ? newIndex : oldIndex, op.id))
        break
      }
      case 'insert-node': case 'remove-node': case 'move-node': {
        const id = op.op === 'insert-node' ? op.node.id : op.id
        const loc = newIndex.get(id) ?? oldIndex.get(id)
        if (loc?.node.tag === 'fdn-artboard-view') {
          if (loc.node.attrs['data-fdn-height'] !== undefined) for (const index of [oldIndex, newIndex]) if (index.has(id)) impact = mergeBakeImpact(impact, scope(index, id))
          break
        }
        if (loc?.node.tag === 'fdn-page') break
        if (loc?.node.tag === 'fdn-artboard' && op.op === 'move-node') break
        for (const index of [oldIndex, newIndex]) if (index.has(id)) impact = mergeBakeImpact(impact, scope(index, id))
        break
      }
      default:
        return { states: null, artboards: null, components: true }
    }
  }
  return impact
}
