import { describe, expect, it } from 'vitest'
import { parseClientMessage, parseServiceMessage, SESSION_PROTOCOL } from '../src/session.ts'
import type { FdnDocument } from '../src/session.ts'

const node = { id: 'n1', tag: 'div', attrs: { class: 'a' }, style: { color: 'red' }, styleStates: { hover: { color: 'blue' } }, children: [] }
const doc: FdnDocument = {
  specVersion: '0.0.1-draft',
  title: 'T',
  tokens: { accent: '#fff' },
  params: [{ name: 'mode', type: 'enum', values: ['a', 'b'], default: 'a' }],
  data: [{ name: 'items', items: [{ name: 'x' }] }],
  lookups: [{ name: 'colors', entries: { a: 'red' } }],
  states: [{ name: 'b', assignments: { mode: 'b' } }],
  viewports: [{ name: 'wide', width: 1440, height: 900 }],
  matrix: [{ state: 'b', viewport: 'wide' }],
  namedStyles: [{ name: 'card', style: {}, styleStates: {} }],
  components: [{ name: 'Card', props: [{ name: 'label', type: 'string', default: 'L' }], slots: [], body: [node] }],
  body: [{ ...node, children: [{ ...node, id: 'n2', text: 'hi', children: [] }] }],
  annotations: [{ id: 'a1', nodeId: 'n1', text: 'look', status: 'open' }],
}
const view = { rev: 3, doc, head: { hash: 'h', prevHash: null, author: 'user:a', message: 'm', specVersion: '0.0.1-draft' }, history: { canUndo: true, canRedo: false, undoLabel: 'Move', redoLabel: null }, issues: [{ code: 'x', severity: 'warning', message: 'm', nodeId: 'n1' }] }
const line = (value: unknown): string => JSON.stringify(value)

describe('parseClientMessage', () => {
  it('accepts every client message shape', () => {
    const messages = [
      { t: 'hello', protocol: SESSION_PROTOCOL, client: 'apiary', author: '' },
      { t: 'view', states: [null, 'b'], components: true },
      {
        t: 'commit',
        id: 'c1',
        base: 1,
        label: 'Edit',
        ops: [
          { op: 'insert-node', parent: null, index: 0, node },
          { op: 'remove-node', id: 'n1' },
          { op: 'move-node', id: 'n1', parent: 'n2', index: 1 },
          { op: 'set-attr', id: 'n1', key: 'title', value: null },
          { op: 'set-style', id: 'n1', prop: 'color', value: 'red', state: 'hover' },
          { op: 'set-style-ref', id: 'n1', styleRef: 'card' },
          { op: 'set-text', id: 'n1', text: 'x' },
          { op: 'set-when', id: 'n1', when: null },
          { op: 'set-token', name: 'accent', value: '#000' },
          { op: 'set-named-style', style: doc.namedStyles[0] },
          { op: 'remove-named-style', name: 'card' },
          { op: 'set-component', component: doc.components[0] },
          { op: 'remove-component', name: 'Card' },
          { op: 'set-param', param: doc.params[0] },
          { op: 'set-lookup', lookup: doc.lookups[0] },
          { op: 'set-state', state: doc.states[0] },
          { op: 'annotate', annotation: doc.annotations[0] },
          { op: 'set-annotation-status', id: 'a1', status: 'resolved' },
          { op: 'remove-annotation', id: 'a1' },
          { op: 'replace-document', doc },
        ],
      },
      { t: 'undo', id: 'u1' },
      { t: 'redo', id: 'r1' },
      { t: 'log', id: 'l1', limit: 20 },
    ]
    for (const message of messages) expect(parseClientMessage(line(message)), message.t).toEqual(message)
  })

  it('rejects malformed lines', () => {
    const bad = [
      '',
      'not json',
      '[1,2]',
      'null',
      line({ protocol: '0.1' }),
      line({ t: 'nope' }),
      line({ t: 'hello', protocol: '0.1', client: 'x' }),
      line({ t: 'hello', protocol: 1, client: 'x', author: '' }),
      line({ t: 'view', states: [1], components: true }),
      line({ t: 'view', states: [], components: 'yes' }),
      line({ t: 'commit', id: 'c', base: -1, ops: [], label: '' }),
      line({ t: 'commit', id: 'c', base: 1.5, ops: [], label: '' }),
      line({ t: 'commit', id: 'c', base: 1, ops: [{ op: 'explode' }], label: '' }),
      line({ t: 'commit', id: 'c', base: 1, ops: [{ op: 'set-style', id: 'n1', prop: 'color', value: 3 }], label: '' }),
      line({ t: 'commit', id: 'c', base: 1, ops: [{ op: 'set-style', id: 'n1', prop: 'color', value: 'red', state: 'pressed' }], label: '' }),
      line({ t: 'commit', id: 'c', base: 1, ops: [{ op: 'insert-node', parent: null, index: 0, node: { ...node, children: [{ id: 'n3' }] } }], label: '' }),
      line({ t: 'commit', id: 'c', base: 1, ops: [{ op: 'replace-document', doc: { ...doc, body: 'x' } }], label: '' }),
      line({ t: 'commit', id: 'c', base: 1, ops: 'nope', label: '' }),
      line({ t: 'undo' }),
      line({ t: 'log', id: 'l', limit: '5' }),
    ]
    for (const input of bad) expect(parseClientMessage(input), input).toBeNull()
  })
})

describe('parseServiceMessage', () => {
  it('accepts every service message shape', () => {
    const messages = [
      { t: 'welcome', protocol: SESSION_PROTOCOL, path: '/a.fdn.html', docId: null, chain: false, created: true, ...view },
      { t: 'doc', cause: { kind: 'open' }, ...view },
      { t: 'doc', cause: { kind: 'commit', id: 'c1', author: 'user:a' }, ...view },
      { t: 'doc', cause: { kind: 'external', author: null }, ...view },
      { t: 'baked', rev: 3, state: null, html: '<!doctype html>', report: [] },
      { t: 'component', rev: 3, name: 'Card', html: '<!doctype html>', report: [{ code: 'x', severity: 'info', message: 'm' }] },
      { t: 'result', id: 'c1', ok: true, rev: 4 },
      { t: 'result', id: 'c1', ok: false, code: 'conflict', message: 'm' },
      { t: 'log', id: 'l1', entries: [view.head] },
      { t: 'fault', code: 'not-found', message: 'm' },
    ]
    for (const message of messages) expect(parseServiceMessage(line(message)), message.t).toEqual(message)
  })

  it('rejects malformed lines', () => {
    const bad = [
      'garbage',
      line({ t: 'welcome', protocol: '0.1', path: '/a', docId: null, chain: false, created: true }),
      line({ t: 'doc', cause: { kind: 'commit', id: 'c1' }, ...view }),
      line({ t: 'doc', cause: { kind: 'later' }, ...view }),
      line({ t: 'doc', cause: { kind: 'open' }, ...view, doc: { ...doc, tokens: { a: 1 } } }),
      line({ t: 'baked', rev: 1, state: null, html: 5, report: [] }),
      line({ t: 'result', id: 'c1', ok: false, code: 'oops', message: 'm' }),
      line({ t: 'result', id: 'c1', ok: true }),
      line({ t: 'fault', code: 'protocol' }),
      line({ t: 'log', id: 'l1', entries: [{ hash: 'h' }] }),
    ]
    for (const input of bad) expect(parseServiceMessage(input), input).toBeNull()
  })
})
