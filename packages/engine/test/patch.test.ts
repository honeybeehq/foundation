import { describe, expect, it } from 'vitest'
import { applyPatch, createChain, diffPatch, projectDocument } from '../src/index.js'
import type { FdnDocument, FdnNode, PatchOp } from '../src/index.js'

const el = (id: string, children: FdnNode[] = []): FdnNode => ({ id, tag: 'div', attrs: {}, style: {}, styleStates: {}, children })
const base: FdnDocument = {
  specVersion: '0.0.1-draft',
  tokens: { a: '1px' },
  params: [],
  data: [],
  lookups: [],
  states: [],
  viewports: [],
  matrix: [],
  namedStyles: [],
  components: [],
  body: [el('n1', [el('n2'), el('n3')]), el('n4')],
  annotations: [],
}

describe('applyPatch', () => {
  it('rejects bad references without applying anything', () => {
    const cases: [PatchOp[], string][] = [
      [[{ op: 'set-style', id: 'nope', prop: 'color', value: 'red' }], 'unknown-node'],
      [[{ op: 'insert-node', parent: 'nope', index: 0, node: el('x') }], 'unknown-node'],
      [[{ op: 'insert-node', parent: null, index: 0, node: el('x', [el('n2')]) }], 'duplicate-id'],
      [[{ op: 'insert-node', parent: null, index: 0, node: el('x') }, { op: 'insert-node', parent: null, index: 0, node: el('x') }], 'duplicate-id'],
      [[{ op: 'insert-node', parent: null, index: 3, node: el('x') }], 'invalid-op'],
      [[{ op: 'move-node', id: 'n1', parent: 'n2', index: 0 }], 'invalid-op'],
      [[{ op: 'move-node', id: 'n2', parent: 'n1', index: 2 }], 'invalid-op'],
      [[{ op: 'set-annotation-status', id: 'a9', status: 'resolved' }], 'invalid-op'],
    ]
    for (const [ops, code] of cases) {
      const result = applyPatch(base, ops)
      expect(result.ok ? 'ok' : result.error.code, JSON.stringify(ops)).toBe(code)
    }
  })

  it('computes an inverse that restores the document, including ops on nodes inserted earlier in the batch', () => {
    const ops: PatchOp[] = [
      { op: 'insert-node', parent: 'n1', index: 1, node: el('x') },
      { op: 'set-style', id: 'x', prop: 'color', value: 'red' },
      { op: 'move-node', id: 'n4', parent: 'x', index: 0 },
      { op: 'set-token', name: 'a', value: null },
    ]
    const forward = applyPatch(base, ops)
    if (!forward.ok) throw new Error(forward.error.message)
    const back = applyPatch(forward.doc, forward.inverse)
    if (!back.ok) throw new Error(back.error.message)
    expect(back.doc).toEqual(base)
  })
})

describe('diffPatch', () => {
  it('produces ops that turn one document into the other through the chain', () => {
    const target: FdnDocument = structuredClone(base)
    const [n1, n4] = target.body as [FdnNode, FdnNode]
    const wrapper = el('w', [n4])
    target.body = [wrapper, n1]
    n1.children.reverse()
    n1.children[0]!.style.color = 'red'
    target.tokens = { b: '2px' }
    const ops = diffPatch(base, target)
    expect(ops).not.toBeNull()
    const chain = createChain(base, { author: 'x', message: 'init' })
    chain.apply({ author: 'x', message: 'diff' }, ops as PatchOp[])
    expect(projectDocument(chain.doc())).toBe(projectDocument(createChain(target, { author: 'x', message: 'init' }).doc()))
  })

  it('returns null for changes the op vocabulary cannot express', () => {
    expect(diffPatch(base, { ...base, title: 'New' })).toBeNull()
  })
})
