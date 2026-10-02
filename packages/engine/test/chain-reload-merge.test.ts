import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createChain, loadChain } from '../src/index.js'
import type { FdnDocument, FdnNode } from '../src/index.js'

const el = (id: string): FdnNode => ({ id, tag: 'p', attrs: {}, style: {}, styleStates: {}, children: [] })
const doc = (ids: string[]): FdnDocument => ({
  specVersion: '0.0.1-draft',
  tokens: {},
  params: [],
  data: [],
  lookups: [],
  states: [],
  viewports: [],
  matrix: [],
  namedStyles: [],
  components: [],
  body: ids.map(el),
  annotations: [],
})

describe('chain reload and merge', () => {
  it('edits nodes recreated by replace-document after loading, ignoring the deleted originals', () => {
    const board = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'boards', 'tracks-pane.fdn.html.chain')
    const chain = loadChain(readFileSync(board), { actor: 'b' })
    const target = chain.doc().body[0]?.children[0]?.id as string
    chain.apply({ author: 'b', message: 'edit' }, [{ op: 'set-style', id: target, prop: 'color', value: 'red' }])
    expect(chain.doc().body[0]?.children[0]?.style.color).toBe('red')
  })

  it('keeps the other side’s anchors on merge', () => {
    const ours = createChain(doc(['n1']), { author: 'a', message: 'init' })
    const theirs = loadChain(ours.save(), { actor: 'b' })
    theirs.anchor('review')
    ours.merge(theirs)
    expect(() => loadChain(ours.save()).checkout('review')).not.toThrow()
  })
})

describe('replace-document', () => {
  it('reconciles the tree in place so concurrent whole-document writes merge without duplicating nodes', () => {
    const base = createChain(doc(['n1', 'n2']), { author: 'a', message: 'init' })
    const left = loadChain(base.save(), { actor: 'left' })
    const right = loadChain(base.save(), { actor: 'right' })
    const leftDoc = doc(['n1', 'n2', 'n3'])
    const rightDoc = doc(['n1', 'n2'])
    rightDoc.body[1]!.style = { color: 'red' }
    left.apply({ author: 'left', message: 'add' }, [{ op: 'replace-document', doc: leftDoc }])
    right.apply({ author: 'right', message: 'style' }, [{ op: 'replace-document', doc: rightDoc }])
    left.merge(right)
    expect(left.doc().body.map((n) => n.id)).toEqual(['n1', 'n2', 'n3'])
    expect(left.doc().body[1]?.style).toEqual({ color: 'red' })
  })
})
