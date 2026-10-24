import { describe, expect, it } from 'vitest'
import { createChain, loadChain } from 'foundation-engine'
import type { FdnNode } from 'foundation-engine'
import { skeletonDocumentEmpty } from '../src/commands/new.js'
import { prepareImportedComponent, remintComponentIds } from '../src/commands/import.js'

const node = (id: string, text: string): FdnNode => ({ id, tag: 'p', text, attrs: {}, style: {}, styleStates: {}, children: [] })

describe('import identity preservation', () => {
  it('keeps ids with the same content through middle insertion and sibling reorder', () => {
    const old = [node('first', 'First'), node('last', 'Last')]
    const inserted = remintComponentIds([node('n1', 'First'), node('n2', 'Middle'), node('n3', 'Last')], old)
    expect(inserted.map(node => node.id)).toEqual(['first', expect.stringMatching(/^n-/), 'last'])
    const reordered = remintComponentIds([node('n1', 'Last'), node('n2', 'First')], old)
    expect(reordered.map(node => node.id)).toEqual(['last', 'first'])
    const changed = remintComponentIds([node('n1', 'Unrelated')], old)
    expect(changed[0]?.id).not.toBe('first')
  })

  it('consumes an old identity once when identical siblings are duplicated', () => {
    const result = remintComponentIds([node('n1', 'Same'), node('n2', 'Same')], [node('old', 'Same')])
    expect(result[0]?.id).toBe('old')
    expect(result[1]?.id).not.toBe('old')
  })

  it('renames only exact generated lookup expressions, preserving literals, properties and aliases', () => {
    const doc = skeletonDocumentEmpty('Test')
    const body = [
      node('n1', '{{ lookup_1[prop.kind] }}'),
      node('n2', '{{ lookup_10[prop.kind] }}'),
      node('n3', "{{ 'lookup_1[prop.kind]' }}"),
      node('n4', '{{ prop.lookup_1 }}'),
      { ...node('n5', '{{ lookup_1.label }}'), each: 'lookup_1 in data.rows', attrs: { lookup_1: 'literal' } },
      node('n6', "{{ '{{ lookup_1[prop.kind] }}' }}"),
    ]
    const result = prepareImportedComponent(doc, { component: { name: 'Test', props: [], slots: [], body }, mode: 'native', report: [], extraTokens: {}, extraLookups: [{ name: 'lookup_1', entries: { a: 'First' } }, { name: 'lookup_10', entries: { a: 'Second' } }] })
    const [one, ten] = result.extraLookups
    expect(one!.name).not.toBe(ten!.name)
    expect(result.component.body[0]?.text).toBe(`{{ ${one!.name}[prop.kind] }}`)
    expect(result.component.body[1]?.text).toBe(`{{ ${ten!.name}[prop.kind] }}`)
    for (const i of [2, 3, 4, 5]) expect(result.component.body[i]?.text).toBe(body[i]?.text)
    expect(result.component.body[4]?.each).toBe(body[4]?.each)
    expect(result.component.body[4]?.attrs).toEqual({ lookup_1: 'literal' })
  })
  it('rejects a generated lookup reference outside the producer syntax', () => {
    expect(() => prepareImportedComponent(skeletonDocumentEmpty('Test'), {
      component: { name: 'Test', props: [], slots: [], body: [node('n1', '{{ oldLookup[param.kind] }}')] },
      mode: 'native', report: [], extraTokens: {}, extraLookups: [{ name: 'oldLookup', entries: { a: 'A' } }],
    })).toThrow('unsupported generated lookup expression')
  })

  it('keeps comments targeting a changed imported node instead of deleting them', () => {
    const doc = skeletonDocumentEmpty('Test')
    doc.components = [{ name: 'Test', props: [], slots: [], body: [node('old-node', 'Before')] }]
    doc.annotations = [{ id: 'a1', text: 'Keep this comment', nodeId: 'old-node', status: 'open' }]
    const chain = createChain(doc, { author: 'user:test', message: 'seed' })
    const { component } = prepareImportedComponent(doc, {
      component: { ...doc.components[0]!, body: [node('n1', 'After')] }, mode: 'native', report: [], extraTokens: {}, extraLookups: [],
    })
    expect(component.body[0]?.id).not.toBe('old-node')
    chain.apply({ author: 'user:test', message: 'reimport' }, [{ op: 'set-component', component }])
    const loaded = loadChain(chain.save())
    expect(loaded.doc().annotations).toEqual(doc.annotations)
    // The target no longer exists, but the comment is retained for enumeration/reanchoring.
    expect(loaded.doc().components[0]?.body.some(node => node.id === 'old-node')).toBe(false)
  })

})
