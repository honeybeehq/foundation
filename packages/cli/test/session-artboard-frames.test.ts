import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ARTBOARD_FRAME_VERSION, ARTBOARD_VERSION, indexNodes, loadChain, parseDocument, projectDocument } from 'foundation-engine'
import type { FdnDocument, FdnNode } from 'foundation-engine'
import type { ClientMessage, SessionOp, WireServiceMessage } from 'foundation-protocol'
import { createSession } from '../src/session/session.js'
import { skeletonDocumentEmpty } from '../src/commands/new.js'

const node = (id: string, tag: string, attrs: Record<string, string> = {}, children: FdnNode[] = []): FdnNode => ({ id, tag, attrs, children, style: {}, styleStates: {} })

function fixture(specVersion: string): FdnDocument {
  return {
    ...skeletonDocumentEmpty('Pre-T107 artboard'), specVersion,
    namedStyles: [{ name: 'Panel', style: { 'background-color': '#ff0000' }, styleStates: {} }],
    tokenCollections: [{ name: 'theme', modes: ['light', 'dark'], tokens: [] }],
    body: [node('page', 'fdn-page', { 'data-fdn-name': 'Page' }, [node('board', 'fdn-artboard', {
      'data-fdn-name': 'Board', 'data-fdn-x': '0', 'data-fdn-y': '0', 'data-fdn-width': '320', 'data-fdn-height': '240',
      'data-fdn-overflow': 'clip', 'data-fdn-padding-top': '12', 'data-fdn-padding-right': '16', 'data-fdn-padding-bottom': '20', 'data-fdn-padding-left': '24',
    }, [node('child', 'div')])])],
  }
}

const cases: Array<{ name: string; op: SessionOp; root: Partial<FdnNode>; capture: string | undefined }> = [
  { name: 'auto layout', op: { op: 'set-style', id: 'board', prop: 'display', value: 'flex' }, root: { style: { display: 'flex' } }, capture: 'clip' },
  { name: 'fill', op: { op: 'set-style', id: 'board', prop: 'background-color', value: '#ffffff' }, root: { style: { 'background-color': '#ffffff' } }, capture: 'clip' },
  { name: 'named style', op: { op: 'set-style-ref', id: 'board', styleRef: 'Panel' }, root: { styleRef: 'Panel' }, capture: 'clip' },
  { name: 'mode attribute', op: { op: 'set-attr', id: 'board', key: 'data-fdn-mode-theme', value: 'dark' }, root: { attrs: { 'data-fdn-mode-theme': 'dark' } }, capture: 'clip' },
  { name: 'layout attribute', op: { op: 'set-attr', id: 'board', key: 'data-fdn-layout', value: 'free' }, root: { attrs: { 'data-fdn-layout': 'free' } }, capture: 'clip' },
  { name: 'collection mode', op: { op: 'set-collection-mode', id: 'board', collection: 'theme', mode: 'dark' }, root: { attrs: { 'data-fdn-mode-theme': 'dark' } }, capture: 'clip' },
  ...['overflow', 'overflow-x', 'overflow-y'].map(prop => ({ name: prop, op: { op: 'set-style' as const, id: 'board', prop, value: 'visible' }, root: { style: { [prop]: 'visible' } }, capture: undefined })),
]

describe('session artboard frame expansion', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function open(specVersion: string, boards = 1) {
    const dir = mkdtempSync(join(tmpdir(), 'fdn-frame-promotion-'))
    dirs.push(dir)
    const path = join(dir, 'board.fdn.html')
    const doc = fixture(specVersion)
    if (boards === 2) {
      const second = structuredClone(doc.body[0]!.children[0]!)
      second.id = 'second-board'
      second.children[0]!.id = 'second-child'
      doc.body[0]!.children.push(second)
    }
    writeFileSync(path, projectDocument(doc))
    const sent: WireServiceMessage[] = []
    const session = createSession({ path, send: message => sent.push(message), watch: false })
    const say = (message: ClientMessage) => {
      session.receive(JSON.stringify(message))
      return sent.splice(0)
    }
    say({ t: 'hello', protocol: '0.2', client: 'test', author: 'user:test', artboardFrames: true })
    const read = () => parseDocument(readFileSync(path, 'utf8')).doc
    return { session, say, read, path }
  }

  describe.each([ARTBOARD_VERSION, ARTBOARD_FRAME_VERSION])('%s', specVersion => {
    it.each(cases)('$name migrates the root in one Undo', ({ op, root, capture }) => {
      const { session, say, read, path } = open(specVersion)
      try {
        const before = read()
        const result = say({ t: 'commit', id: 'edit', base: 1, ops: [op], label: 'Frame' }).find(message => message.t === 'result')
        expect(result, JSON.stringify(result)).toMatchObject({ ok: true, rev: 2 })
        const after = read()
        expect(after.specVersion).toBe(ARTBOARD_FRAME_VERSION)
        const board = indexNodes(after.body).get('board')!.node
        expect(board).toMatchObject(root)
        expect(board.style).toMatchObject({ 'padding-top': '12px', 'padding-right': '16px', 'padding-bottom': '20px', 'padding-left': '24px' })
        expect(Object.keys(board.attrs).some(key => key.startsWith('data-fdn-padding-'))).toBe(false)
        expect(board.attrs['data-fdn-overflow']).toBe(capture)
        expect(loadChain(readFileSync(`${path}.chain`)).log().map(entry => entry.message).filter(message => message === 'Frame')).toHaveLength(1)
        expect(say({ t: 'undo', id: 'undo' }).find(message => message.t === 'result')).toMatchObject({ ok: true, rev: 3 })
        expect(read()).toEqual(before)
      } finally { session.close() }
    })
  })

  it('migrates a board inside a mixed descendant batch with one Undo', () => {
    const { session, say, read } = open(ARTBOARD_VERSION, 2)
    try {
      const before = read()
      const result = say({ t: 'commit', id: 'mixed', base: 1, label: 'Mixed', ops: [
        { op: 'set-style', id: 'child', prop: 'color', value: 'red' },
        cases[0]!.op,
        { op: 'set-text', id: 'child', text: 'Edited' },
      ] }).find(message => message.t === 'result')
      expect(result).toMatchObject({ ok: true, rev: 2 })
      const after = read()
      expect(after.specVersion).toBe(ARTBOARD_FRAME_VERSION)
      expect(indexNodes(after.body).get('child')!.node).toMatchObject({ style: { color: 'red' }, text: 'Edited' })
      expect(indexNodes(after.body).get('board')!.node.style).toMatchObject({ display: 'flex', 'padding-top': '12px' })
      expect(indexNodes(after.body).get('second-board')!.node).toEqual(indexNodes(before.body).get('second-board')!.node)
      expect(say({ t: 'undo', id: 'undo' }).find(message => message.t === 'result')).toMatchObject({ ok: true })
      expect(read()).toEqual(before)
    } finally { session.close() }
  })

  it('migrates a second board after the first board promotes the document', () => {
    const { session, say, read } = open(ARTBOARD_VERSION, 2)
    try {
      const before = read()
      expect(say({ t: 'commit', id: 'first', base: 1, label: 'First', ops: [cases[0]!.op] }).find(message => message.t === 'result')).toMatchObject({ ok: true })
      const first = read()
      expect(first.specVersion).toBe(ARTBOARD_FRAME_VERSION)
      expect(indexNodes(first.body).get('second-board')!.node).toEqual(indexNodes(before.body).get('second-board')!.node)
      expect(say({ t: 'commit', id: 'second', base: 2, label: 'Second', ops: [{ op: 'set-style', id: 'second-board', prop: 'background-color', value: '#ffffff' }] }).find(message => message.t === 'result')).toMatchObject({ ok: true })
      const second = indexNodes(read().body).get('second-board')!.node
      expect(second.style).toMatchObject({ 'background-color': '#ffffff', 'padding-top': '12px', 'padding-right': '16px', 'padding-bottom': '20px', 'padding-left': '24px' })
      expect(Object.keys(second.attrs).some(key => key.startsWith('data-fdn-padding-'))).toBe(false)
      expect(second.attrs['data-fdn-overflow']).toBe('clip')
      expect(say({ t: 'undo', id: 'undo-second' }).find(message => message.t === 'result')).toMatchObject({ ok: true })
      expect(read()).toEqual(first)
      expect(say({ t: 'undo', id: 'undo-first' }).find(message => message.t === 'result')).toMatchObject({ ok: true })
      expect(read()).toEqual(before)
    } finally { session.close() }
  })

  it('refuses an invalid tail without persisting promotion or migration', () => {
    const { session, say, read } = open(ARTBOARD_VERSION)
    try {
      const before = read()
      expect(say({ t: 'commit', id: 'bad', base: 1, label: 'Invalid tail', ops: [cases[0]!.op, { op: 'set-style', id: 'missing', prop: 'color', value: 'red' }] }).find(message => message.t === 'result')).toMatchObject({ ok: false, code: 'unknown-node' })
      expect(read()).toEqual(before)
    } finally { session.close() }
  })

  it('keeps descendant edits in the original format', () => {
    const { session, say, read } = open(ARTBOARD_VERSION)
    try {
      const result = say({ t: 'commit', id: 'child', base: 1, label: 'Child color', ops: [{ op: 'set-style', id: 'child', prop: 'color', value: 'red' }] }).find(message => message.t === 'result')
      expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
      expect(read().specVersion).toBe(ARTBOARD_VERSION)
      expect(indexNodes(read().body).get('board')!.node.attrs).toEqual(indexNodes(fixture(ARTBOARD_VERSION).body).get('board')!.node.attrs)
      expect(indexNodes(read().body).get('board')!.node.style).toEqual({})
    } finally { session.close() }
  })
})
