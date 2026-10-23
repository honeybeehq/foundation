import { indexNodes } from 'foundation-engine'
import type { FdnDocument, PatchOp } from 'foundation-engine'

export interface BakeImpact {
  states: Set<string | null> | null
  components: boolean
}

export function mergeBakeImpact(a: BakeImpact, b: BakeImpact): BakeImpact {
  return { states: a.states && b.states ? new Set([...a.states, ...b.states]) : null, components: a.components || b.components }
}

export function bakeImpact(doc: FdnDocument, ops: PatchOp[]): BakeImpact {
  let impact: BakeImpact = { states: new Set(), components: false }
  let index: ReturnType<typeof indexNodes> | undefined
  for (const op of ops) {
    switch (op.op) {
      case 'annotate':
      case 'set-annotation-status':
      case 'remove-annotation':
      case 'set-matrix':
      case 'set-viewport':
      case 'remove-viewport':
        break
      case 'set-attr':
      case 'set-style':
      case 'set-style-ref':
      case 'set-text':
      case 'set-when': {
        if (op.op === 'set-attr' && op.key === 'data-fdn-state') return { states: null, components: false }
        index ??= indexNodes(doc.body)
        let location = index.get(op.id)
        if (!location) return { states: null, components: true }
        const scopes = new Set<string>()
        while (location) {
          const scope = location.node.attrs['data-fdn-state']
          if (scope !== undefined) scopes.add(scope)
          location = location.parent === null ? undefined : index.get(location.parent)
        }
        const states = scopes.size === 0 ? null : new Set<string | null>([null, ...(scopes.size === 1 ? scopes : [])])
        impact = mergeBakeImpact(impact, { states, components: false })
        break
      }
      case 'insert-node':
      case 'remove-node':
      case 'move-node':
        impact = mergeBakeImpact(impact, { states: null, components: false })
        break
      default:
        return { states: null, components: true }
    }
  }
  return impact
}
