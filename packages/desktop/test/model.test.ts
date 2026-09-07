import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { editsBetween, fromDocument, seedDocument, type DesignModel } from '../src/model.js'
import { createChain } from '../../engine/src/chain/index.js'
import { validateDocument } from '../../engine/src/validate/index.js'

const source = readFileSync(new URL('../../../spikes/desktop-prototype/index.html', import.meta.url), 'utf8')
const model = vm.runInNewContext(`${source.match(/<script id="document-model">([\s\S]*?)<\/script>/)![1]};initialDocument`, { structuredClone }) as DesignModel
const seed = () => seedDocument(model, 'assets/cover.jpeg')
const meta = { author: 'user:test', message: 'Desktop test' }

describe('desktop projection', () => {
  it('keeps genesis small, valid and free of inline images', () => {
    const doc = seed()
    expect(Buffer.byteLength(JSON.stringify(doc))).toBeLessThan(8000)
    expect(JSON.stringify(doc)).not.toContain('data:image')
    expect(validateDocument(doc).issues.filter(i => i.severity === 'error')).toEqual([])
    expect(doc.body.map(n => n.id)).toEqual(['desktop-board', 'mobile-board'])
    expect(fromDocument(doc).nodes.find(n => n.id === 'photo')?.asset).toBe('assets/cover.jpeg')
    expect(fromDocument(doc).nodes.find(n => n.id === 'heading')?.text).toBe(model.nodes[0]?.text)
    expect(() => seedDocument(model, 'data:image/jpeg;base64,abc')).toThrow('bundled asset')
  })
  it('sends only changed leaves and retains changes from another replica', () => {
    const chain = createChain(seed(), meta, { actor: 'desktop-a', docId: 'desktop-test' })
    const before = fromDocument(chain.doc())
    const after = structuredClone(before)
    after.nodes[0]!.x += 25
    const ops = editsBetween(before, after)
    expect(ops).toEqual([{ op: 'set-style', id: 'heading', prop: 'left', value: '63px' }])
    chain.apply(meta, [{ op: 'set-text', id: 'heading', text: 'Remote copy edit' }, { op: 'set-token', name: 'sage', value: '#abcdef' }])
    chain.apply(meta, ops)
    const actual = fromDocument(chain.doc())
    expect(actual.nodes[0]?.text).toBe('Remote copy edit')
    expect(actual.nodes[0]?.x).toBe(63)
    expect(actual.tokens.sage).toBe('#abcdef')
  })
  it('roundtrips text, token, fill, insertion and inverse ops through Loro', () => {
    const chain = createChain(seed(), meta, { actor: 'desktop-a', docId: 'desktop-test' })
    const before = fromDocument(chain.doc()), after = structuredClone(before)
    after.tokens.forest = '#111111'
    after.nodes[0]!.text = 'Edited safely </script>'
    after.nodes[0]!.color = '#222222'
    after.nodes.push({ id: 'rectangle-new', name: 'New rectangle', board: 'desktop', type: 'shape', x: 1, y: 2, w: 100, h: 50, opacity: 75, radius: 3, token: 'sage' })
    const ops = editsBetween(before, after)
    expect(ops.some(op => op.op === 'replace-document')).toBe(false)
    chain.apply(meta, ops)
    expect(fromDocument(chain.doc()).nodes.find(n => n.id === "rectangle-new")).toEqual(after.nodes.at(-1))
    expect(fromDocument(chain.doc()).nodes[0]?.text).toBe(after.nodes[0]?.text)
    chain.apply(meta, editsBetween(after, before))
    expect(fromDocument(chain.doc())).toEqual(before)
  })
})
