import { canonicalTransform, constraintStyle, constraintsOf, effectiveStyle, freeBounds, freeTransform, hasStateStyles, transformStyle } from './free-geometry.js'
import { applyPatch, indexNodes } from 'foundation-engine'
import type { FdnDocument, PatchOp, PatchErrorCode } from 'foundation-engine'
import type { PlacementOp } from 'foundation-protocol'

export class PlacementError extends Error {
  constructor(readonly code: PatchErrorCode, message: string) {
    super(message)
  }
}

export function expandPlacement(doc: FdnDocument, ops: Array<PatchOp | PlacementOp>): PatchOp[] {
  if (ops.every((op): op is PatchOp => !['set-frame-mode', 'set-placement', 'set-free-position', 'resize-free', 'set-free-rotation', 'set-free-flip', 'set-free-constraints'].includes(op.op))) return ops
  let working = doc
  const expanded: PatchOp[] = []
  for (const op of ops) {
    const index = indexNodes(working.body)
    const style = (id: string, values: Record<string, string | null>): PatchOp[] => Object.entries(values).map(([prop, value]) => ({ op: 'set-style', id, prop, value }))
    const node = 'id' in op ? index.get(op.id)?.node : undefined
    let batch: PatchOp[]
    switch (op.op) {
      case 'set-frame-mode': {
        if (!node) throw new PlacementError('unknown-node', `unknown node "${op.id}"`)
        batch = [{ op: 'set-attr', id: op.id, key: 'data-fdn-layout', value: op.mode }, ...style(op.id, { position: node.style.position === 'absolute' ? 'absolute' : 'relative', display: op.mode === 'free' ? 'block' : (node.style.display === 'grid' ? 'grid' : 'flex') })]
        break
      }
      case 'set-placement':
      case 'set-free-position':
      case 'set-free-rotation':
      case 'set-free-flip':
      case 'set-free-constraints':
      case 'resize-free': {
        if (!node) throw new PlacementError('unknown-node', `unknown node "${op.id}"`)
        const parentId = index.get(op.id)?.parent
        const parent = parentId ? index.get(parentId)?.node : undefined
        if (!parent || !['free', 'flow'].includes(parent.attrs['data-fdn-layout'] ?? '') || !['relative', 'absolute'].includes(parent.style.position ?? '')) {
          throw new Error('placement needs a direct parent frame with data-fdn-layout and position:relative or absolute')
        }
        if (op.op === 'set-placement' && op.mode === 'flow') {
          batch = style(op.id, { position: ['free', 'flow'].includes(node.attrs['data-fdn-layout'] ?? '') ? 'relative' : 'static', left: 'auto', top: 'auto', right: 'auto', bottom: 'auto' })
          const currentStyle = effectiveStyle(working, node)
          const transform = canonicalTransform(currentStyle)
          if (transform) {
            batch.push(...style(op.id, transformStyle({ ...transform, centerX: false, centerY: false })))
          }
          break
        }
        if (op.op !== 'set-placement' && node.style.position !== 'absolute') throw new Error('convert this child to free placement first')
        const effective = effectiveStyle(working, node)
        const stateful = hasStateStyles(working, node) || hasStateStyles(working, parent)
        if (op.op === 'set-free-rotation' || op.op === 'set-free-flip' || op.op === 'set-free-constraints') {
          const transform = freeTransform(effective)
          if (op.op === 'set-free-rotation') batch = style(op.id, transformStyle({ ...transform, degrees: op.degrees }))
          else if (op.op === 'set-free-flip') batch = style(op.id, transformStyle({ ...transform, x: op.x ?? transform.x, y: op.y ?? transform.y }))
          else {
            if (Object.keys(effective).some((key) => key.startsWith('inset'))) throw new Error('normalize inset shorthands and logical insets to physical left/right/top/bottom before setting constraints')
            batch = style(op.id, constraintStyle(freeBounds(effective, effectiveStyle(working, parent), op.bounds, stateful), op.h, op.v, transform))
          }
          break
        }
        if (op.op === 'set-free-position' || op.op === 'resize-free') {
          const transform = canonicalTransform(effective)
          const constraints = transform ? constraintsOf(effective, transform) : { h: 'left' as const, v: 'top' as const }
          if (constraints.h !== 'left' || constraints.v !== 'top') {
            const currentTransform = transform!
            if (Object.keys(effective).some((key) => key.startsWith('inset'))) throw new Error('normalize inset shorthands and logical insets before editing constrained geometry')
            const bounds = freeBounds(effective, effectiveStyle(working, parent), op.bounds, stateful)
            if (op.op === 'set-free-position') { bounds.x = op.x; bounds.y = op.y }
            else { bounds.width = op.width; bounds.height = op.height }
            if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width < 0 || bounds.height < 0) throw new Error('free geometry must be finite with nonnegative dimensions')
            batch = style(op.id, constraintStyle(bounds, constraints.h, constraints.v, currentTransform))
            break
          }
        }
        if (op.op === 'resize-free') {
          if (![op.width, op.height].every((n) => Number.isFinite(n) && n >= 0)) throw new Error('width and height must be finite and nonnegative')
          batch = style(op.id, { width: `${op.width}px`, height: `${op.height}px`, 'box-sizing': 'border-box' })
        } else {
          const bounds = op.op === 'set-placement' ? op.bounds : op
          if (!bounds || ![bounds.x, bounds.y].every(Number.isFinite)) throw new Error('free placement needs finite x and y measured from the frame padding edge')
          batch = style(op.id, { position: 'absolute', left: `${bounds.x}px`, top: `${bounds.y}px`, right: 'auto', bottom: 'auto', 'margin-top': '0px', 'margin-right': '0px', 'margin-bottom': '0px', 'margin-left': '0px' })
          if (op.op === 'set-placement') {
            if (!bounds || !('width' in bounds) || !('height' in bounds) || ![bounds.width, bounds.height].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) throw new Error('conversion needs measured nonnegative width and height')
            batch.push(...style(op.id, { width: `${bounds.width}px`, height: `${bounds.height}px`, 'box-sizing': 'border-box' }))
            const transform = canonicalTransform(effective)
            if (transform) batch.push(...style(op.id, transformStyle({ ...transform, centerX: false, centerY: false })))
          }
        }
        break
      }
      default:
        batch = [op]
    }
    const patch = applyPatch(working, batch, { validateTokens: false })
    if (!patch.ok) throw new PlacementError(patch.error.code, patch.error.message)
    working = patch.doc
    expanded.push(...patch.applied)
  }
  return expanded
}
