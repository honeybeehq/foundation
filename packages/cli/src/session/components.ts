import { componentSelection, indexNodes } from 'foundation-engine'
import type { FdnDocument, PatchOp } from 'foundation-engine'
import type { ComponentOp } from 'foundation-protocol'

export function expandComponentOp(doc: FdnDocument, op: ComponentOp): PatchOp[] {
  const node = indexNodes(doc.body).get(op.id)?.node
  if (!node || node.tag !== 'fdn-use' || !node.attrs['component-set']) throw new Error(`"${op.id}" must be a component set instance`)
  const attrs = { ...node.attrs }
  if (op.values === null) {
    for (const key of Object.keys(attrs)) if (key.startsWith('data-fdn-variant-')) delete attrs[key]
  } else {
    for (const [axis, value] of Object.entries(op.values)) {
      if (value === null) delete attrs[`data-fdn-variant-${axis}`]
      else attrs[`data-fdn-variant-${axis}`] = value
    }
  }
  componentSelection(doc, { attrs })
  const keys = new Set([...Object.keys(node.attrs), ...Object.keys(attrs)])
  return [...keys].filter((key) => node.attrs[key] !== attrs[key]).map((key) => ({ op: 'set-attr', id: op.id, key, value: attrs[key] ?? null }))
}
