import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createChain, loadChain, parseDocument, projectDocument } from 'foundation-engine'
import type { FdnDocument, FdnNode } from 'foundation-engine'
import type { ClientMessage, ServiceMessage } from 'foundation-protocol'
import { createSession, type SessionOptions } from '../src/session/session.js'
import { skeletonDocument } from '../src/commands/new.js'

type Of<T extends ServiceMessage['t']> = Extract<ServiceMessage, { t: T }>

const el = (id: string, extra: Partial<FdnNode> = {}): FdnNode => ({ id, tag: 'p', attrs: {}, style: {}, styleStates: {}, children: [], ...extra })

function start(path: string, options: Partial<SessionOptions> = {}) {
  const sent: ServiceMessage[] = []
  const session = createSession({ path, send: (message) => sent.push(message), watch: false, ...options })
  const say = (message: ClientMessage): ServiceMessage[] => {
    session.receive(JSON.stringify(message))
    return sent.splice(0)
  }
  const open = (author = 'user:test'): ServiceMessage[] => say({ t: 'hello', protocol: '0.1', client: 'test', author })
  return { session, sent, say, open }
}

function only<T extends ServiceMessage['t']>(messages: ServiceMessage[], t: T): Of<T>[] {
  return messages.filter((message): message is Of<T> => message.t === t)
}

function result(messages: ServiceMessage[]): Of<'result'> {
  const found = only(messages, 'result')
  expect(found).toHaveLength(1)
  return found[0] as Of<'result'>
}

function writeDocument(path: string, doc: FdnDocument, withChain: boolean): void {
  writeFileSync(path, projectDocument(doc))
  if (withChain) writeFileSync(`${path}.chain`, createChain(doc, { author: 'user:seed', message: 'init' }).save())
}

function chainLog(path: string): string[] {
  return loadChain(readFileSync(`${path}.chain`)).log().map((entry) => `${entry.author}: ${entry.message}`)
}

describe('foundation session', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fdn-session-'))
    file = join(dir, 'board.fdn.html')
  })

  afterEach(() => {
    chmodSync(dir, 0o755)
    rmSync(dir, { recursive: true, force: true })
  })

  describe('opening', () => {
    it('waits for hello and faults on a protocol mismatch with exit 2', async () => {
      writeDocument(file, skeletonDocument('Board'), true)
      const { say, session } = start(file)
      const messages = say({ t: 'hello', protocol: '9.9', client: 'test', author: '' })
      expect(messages).toEqual([{ t: 'fault', code: 'protocol', message: expect.stringContaining('9.9') }])
      expect(await session.done).toBe(2)
    })

    it('faults when the first message is not hello', async () => {
      const { say, session } = start(file)
      expect(say({ t: 'undo', id: 'u' })[0]).toMatchObject({ t: 'fault', code: 'protocol' })
      expect(await session.done).toBe(2)
    })

    it('opens an existing document at rev 1', () => {
      writeDocument(file, skeletonDocument('Board'), true)
      const { open } = start(file)
      const [welcome] = open()
      expect(welcome).toMatchObject({ t: 'welcome', protocol: '0.1', path: file, chain: true, created: false, rev: 1, head: { author: 'user:seed' } })
      expect((welcome as Of<'welcome'>).doc.body.map((n) => n.id)).toEqual(['n1', 'n2'])
    })

    it('faults not-found without --create', async () => {
      const { open, session } = start(file)
      expect(open()).toEqual([{ t: 'fault', code: 'not-found', message: expect.any(String) }])
      expect(await session.done).toBe(1)
    })

    it('scaffolds an empty document with a chain on --create', () => {
      const { open } = start(join(dir, 'nested', 'fresh.fdn.html'), { create: true, title: 'Fresh Board' })
      const [welcome] = open('user:maker')
      expect(welcome).toMatchObject({ t: 'welcome', created: true, chain: true, docId: expect.any(String), rev: 1 })
      expect((welcome as Of<'welcome'>).doc).toMatchObject({ title: 'Fresh Board', body: [] })
      const text = readFileSync(join(dir, 'nested', 'fresh.fdn.html'), 'utf8')
      expect(text).toContain(`data-fdn-doc-id="${(welcome as Of<'welcome'>).docId}"`)
      expect(chainLog(join(dir, 'nested', 'fresh.fdn.html'))).toEqual(['user:maker: init'])
    })

    it('just opens an existing file on --create', () => {
      writeDocument(file, skeletonDocument('Board'), true)
      const { open } = start(file, { create: true })
      expect(open()[0]).toMatchObject({ t: 'welcome', created: false })
    })

    it('refuses to scaffold over an orphaned chain', () => {
      writeFileSync(`${file}.chain`, createChain(skeletonDocument('Board'), { author: 'x', message: 'init' }).save())
      const { open } = start(file, { create: true })
      expect(open()[0]).toMatchObject({ t: 'fault', code: 'exists' })
    })

    it('faults unreadable on a corrupt chain', () => {
      writeDocument(file, skeletonDocument('Board'), false)
      writeFileSync(`${file}.chain`, 'garbage')
      const { open } = start(file)
      expect(open()[0]).toMatchObject({ t: 'fault', code: 'unreadable' })
    })

    it('does not create a chain on open', () => {
      writeDocument(file, skeletonDocument('Board'), false)
      const { open } = start(file)
      expect(open()[0]).toMatchObject({ t: 'welcome', chain: false, head: null })
      expect(existsSync(`${file}.chain`)).toBe(false)
    })

    it('resolves the author from hello, then --author, then $USER', () => {
      writeDocument(file, skeletonDocument('Board'), true)
      const commit: ClientMessage = { t: 'commit', id: 'c', base: 1, ops: [{ op: 'set-text', id: 'n1', text: 'x' }], label: 'Text' }
      const fromFlag = start(file, { author: 'user:flag' })
      fromFlag.open('')
      expect(only(fromFlag.say(commit), 'doc')[0]?.cause).toEqual({ kind: 'commit', id: 'c', author: 'user:flag' })
      const fromHello = start(file, { author: 'user:flag' })
      fromHello.open('user:hello')
      expect(only(fromHello.say(commit), 'doc')[0]?.cause).toMatchObject({ author: 'user:hello' })
      const fromEnv = start(file)
      fromEnv.open('')
      expect(only(fromEnv.say(commit), 'doc')[0]?.cause).toMatchObject({ author: `user:${process.env.USER}` })
    })
  })

  describe('commits', () => {
    beforeEach(() => writeDocument(file, skeletonDocument('Board'), true))

    it('applies one commit as one chain change, writes both files, then sends doc, bakes and result', () => {
      const { open, say } = start(file)
      open()
      expect(only(say({ t: 'view', states: [null], components: false }), 'baked')).toHaveLength(1)
      const messages = say({ t: 'commit', id: 'c1', base: 1, ops: [{ op: 'set-style', id: 'n1', prop: 'color', value: 'red' }], label: 'Color' })
      expect(messages.map((m) => m.t)).toEqual(['doc', 'baked', 'result'])
      expect(messages[0]).toMatchObject({ rev: 2, cause: { kind: 'commit', id: 'c1', author: 'user:test' }, history: { canUndo: true, undoLabel: 'Color' }, head: { message: 'Color' } })
      expect(messages[1]).toMatchObject({ rev: 2, state: null })
      expect((messages[1] as Of<'baked'>).html).toContain('<h1 data-fdn-id="n1" style="color:red">Board</h1>')
      expect(messages[2]).toEqual({ t: 'result', id: 'c1', ok: true, rev: 2 })
      expect(readFileSync(file, 'utf8')).toContain('style="color:red"')
      expect(chainLog(file)).toEqual(['user:seed: init', 'user:test: Color'])
    })

    it('rejects unknown nodes, duplicate ids and invalid ops without applying anything', () => {
      const { open, say } = start(file)
      open()
      const before = readFileSync(`${file}.chain`)
      const attempts: [ClientMessage, string][] = [
        [{ t: 'commit', id: 'a', base: 1, ops: [{ op: 'set-text', id: 'n1', text: 'ok' }, { op: 'set-text', id: 'ghost', text: 'x' }], label: 'x' }, 'unknown-node'],
        [{ t: 'commit', id: 'b', base: 1, ops: [{ op: 'insert-node', parent: null, index: 0, node: el('n2') }], label: 'x' }, 'duplicate-id'],
        [{ t: 'commit', id: 'c', base: 1, ops: [{ op: 'insert-node', parent: null, index: 9, node: el('cnew00001') }], label: 'x' }, 'invalid-op'],
        [{ t: 'commit', id: 'd', base: 1, ops: [], label: 'x' }, 'invalid-op'],
      ]
      for (const [message, code] of attempts) {
        const messages = say(message)
        expect(messages.map((m) => m.t)).toEqual(['result'])
        expect(result(messages)).toMatchObject({ ok: false, code })
      }
      expect(Buffer.compare(readFileSync(`${file}.chain`), before)).toBe(0)
    })

    it('reports write-failed and keeps the previous state when the directory is read-only', () => {
      const { open, say } = start(file)
      open()
      chmodSync(dir, 0o555)
      const failed = say({ t: 'commit', id: 'w', base: 1, ops: [{ op: 'set-text', id: 'n1', text: 'lost' }], label: 'Text' })
      expect(result(failed)).toMatchObject({ ok: false, code: 'write-failed' })
      chmodSync(dir, 0o755)
      const retry = say({ t: 'commit', id: 'w2', base: 1, ops: [{ op: 'set-text', id: 'n1', text: 'kept' }], label: 'Text' })
      expect(result(retry)).toMatchObject({ ok: true, rev: 2 })
      expect(only(retry, 'doc')[0]?.history).toMatchObject({ canUndo: true })
      expect(chainLog(file)).toEqual(['user:seed: init', 'user:test: Text'])
    })

    it('creates the chain on the first commit of a chainless document', () => {
      rmSync(`${file}.chain`)
      const { open, say } = start(file)
      open()
      const messages = say({ t: 'commit', id: 'c', base: 1, ops: [{ op: 'set-text', id: 'n1', text: 'Hello' }], label: 'Text' })
      expect(result(messages)).toMatchObject({ ok: true })
      expect(chainLog(file)).toEqual(['user:test: init', 'user:test: Text'])
      expect(readFileSync(file, 'utf8')).toMatch(/data-fdn-doc-id="[0-9a-f-]{36}"/)
    })

    it('returns the chain log newest first', () => {
      const { open, say } = start(file)
      open()
      say({ t: 'commit', id: 'c1', base: 1, ops: [{ op: 'set-text', id: 'n1', text: 'one' }], label: 'One' })
      say({ t: 'commit', id: 'c2', base: 2, ops: [{ op: 'set-text', id: 'n1', text: 'two' }], label: 'Two' })
      const [log] = say({ t: 'log', id: 'l', limit: 2 })
      expect((log as Of<'log'>).entries.map((e) => e.message)).toEqual(['Two', 'One'])
    })

    it('skips bakes whose output did not change and bakes components on request', () => {
      const { open, say } = start(file)
      open()
      const first = say({ t: 'view', states: [null, 'default'], components: true })
      expect(only(first, 'baked').map((m) => m.state)).toEqual([null, 'default'])
      expect(only(first, 'component').map((m) => m.name)).toEqual(['Card'])
      expect(only(first, 'component')[0]?.html).toContain('data-fdn-id="Card::card-root"')
      const annotate = say({ t: 'commit', id: 'a', base: 1, ops: [{ op: 'annotate', annotation: { id: 'a1', text: 'note', status: 'open' } }], label: 'Note' })
      expect(annotate.map((m) => m.t)).toEqual(['doc', 'result'])
    })
  })

  describe('undo and redo', () => {
    beforeEach(() => writeDocument(file, skeletonDocument('Board'), true))

    it('undoes and redoes as new chain changes', () => {
      const { open, say } = start(file)
      open()
      say({ t: 'commit', id: 'c', base: 1, ops: [{ op: 'insert-node', parent: null, index: 2, node: el('cabc12345', { text: 'new' }) }, { op: 'set-text', id: 'n1', text: 'Renamed' }], label: 'Add' })
      const undo = say({ t: 'undo', id: 'u' })
      expect(undo[0]).toMatchObject({ t: 'doc', rev: 3, cause: { kind: 'undo', id: 'u' }, history: { canUndo: false, canRedo: true, redoLabel: 'Add' } })
      expect((undo[0] as Of<'doc'>).doc.body.map((n) => n.id)).toEqual(['n1', 'n2'])
      expect((undo[0] as Of<'doc'>).doc.body[0]?.text).toBe('{{ param.title }}')
      const redo = say({ t: 'redo', id: 'r' })
      expect((redo[0] as Of<'doc'>).doc.body.map((n) => n.id)).toEqual(['n1', 'n2', 'cabc12345'])
      expect(chainLog(file).slice(1)).toEqual(['user:test: Add', 'user:test: Undo Add', 'user:test: Redo Add'])
      expect(result(say({ t: 'redo', id: 'r2' }))).toMatchObject({ ok: false, code: 'nothing-to-redo' })
    })

    it('answers nothing-to-undo on an empty stack and clears redo on a new commit', () => {
      const { open, say } = start(file)
      open()
      expect(result(say({ t: 'undo', id: 'u0' }))).toMatchObject({ ok: false, code: 'nothing-to-undo' })
      say({ t: 'commit', id: 'c1', base: 1, ops: [{ op: 'set-text', id: 'n1', text: 'a' }], label: 'A' })
      say({ t: 'undo', id: 'u1' })
      const commit = say({ t: 'commit', id: 'c2', base: 3, ops: [{ op: 'set-text', id: 'n1', text: 'b' }], label: 'B' })
      expect(only(commit, 'doc')[0]?.history).toEqual({ canUndo: true, canRedo: false, undoLabel: 'B', redoLabel: null })
    })

    it('answers conflict and drops the entry when someone else changed the same property', () => {
      const { open, say, session } = start(file)
      open()
      say({ t: 'commit', id: 'c', base: 1, ops: [{ op: 'set-style', id: 'n1', prop: 'color', value: 'red' }], label: 'Red' })
      const theirs = loadChain(readFileSync(`${file}.chain`), { actor: 'other' })
      theirs.apply({ author: 'agent:other', message: 'Blue' }, [{ op: 'set-style', id: 'n1', prop: 'color', value: 'blue' }])
      writeFileSync(`${file}.chain`, theirs.save())
      session.sync()
      expect(result(say({ t: 'undo', id: 'u' }))).toMatchObject({ ok: false, code: 'conflict' })
      expect(result(say({ t: 'undo', id: 'u2' }))).toMatchObject({ ok: false, code: 'nothing-to-undo' })
    })

    it('still undoes when others changed unrelated nodes', () => {
      const { open, say, session } = start(file)
      open()
      say({ t: 'commit', id: 'c', base: 1, ops: [{ op: 'set-style', id: 'n1', prop: 'color', value: 'red' }], label: 'Red' })
      const theirs = loadChain(readFileSync(`${file}.chain`), { actor: 'other' })
      theirs.apply({ author: 'agent:other', message: 'Prop' }, [{ op: 'set-attr', id: 'n2', key: 'data-fdn-prop-label', value: 'Theirs' }])
      writeFileSync(`${file}.chain`, theirs.save())
      session.sync()
      const undo = say({ t: 'undo', id: 'u' })
      expect(result(undo)).toMatchObject({ ok: true })
      const doc = (only(undo, 'doc').at(-1) as Of<'doc'>).doc
      expect(doc.body[0]?.style.color).toBe('var(--color-accent)')
      expect(doc.body[1]?.attrs['data-fdn-prop-label']).toBe('Theirs')
    })
  })

  describe('external writers', () => {
    beforeEach(() => writeDocument(file, skeletonDocument('Board'), true))

    it('merges a chain written by someone else and keeps our own unsaved-to-them changes', () => {
      const { open, say, session, sent } = start(file)
      open()
      const stale = loadChain(readFileSync(`${file}.chain`), { actor: 'other' })
      say({ t: 'commit', id: 'c', base: 1, ops: [{ op: 'set-text', id: 'n1', text: 'Ours' }], label: 'Ours' })
      stale.apply({ author: 'agent:other', message: 'Theirs' }, [{ op: 'set-style', id: 'n1', prop: 'color', value: 'blue' }])
      writeFileSync(`${file}.chain`, stale.save())
      session.sync()
      const [doc] = only(sent.splice(0), 'doc')
      expect(doc).toMatchObject({ rev: 3, cause: { kind: 'external', author: 'agent:other' } })
      expect(doc?.doc.body[0]).toMatchObject({ text: 'Ours', style: { color: 'blue' } })
      expect(chainLog(file)).toEqual(expect.arrayContaining(['user:test: Ours', 'agent:other: Theirs']))
      const text = readFileSync(file, 'utf8')
      expect(text).toContain('Ours')
      expect(text).toContain('style="color:blue"')
    })

    it('ingests a hand edit of the text as a change by file', () => {
      const { open, session, sent } = start(file)
      open()
      writeFileSync(file, readFileSync(file, 'utf8').replace('Hello, Foundation', 'Edited by hand'))
      session.sync()
      const [doc] = only(sent.splice(0), 'doc')
      expect(doc).toMatchObject({ cause: { kind: 'external', author: 'file' } })
      expect(doc?.doc.body[1]?.attrs['data-fdn-prop-label']).toBe('Edited by hand')
      expect(chainLog(file)).toEqual(['user:seed: init', 'file: ingest'])
      expect(readFileSync(file, 'utf8')).toContain('Edited by hand')
    })

    it('ingests text edits granularly so a concurrent chain change survives', () => {
      const { open, session, sent } = start(file)
      open()
      const other = loadChain(readFileSync(`${file}.chain`), { actor: 'other' })
      other.apply({ author: 'agent:other', message: 'Note' }, [{ op: 'annotate', annotation: { id: 'a1', nodeId: 'n1', text: 'look', status: 'open' } }])
      writeFileSync(`${file}.chain`, other.save())
      writeFileSync(file, readFileSync(file, 'utf8').replace('Hello, Foundation', 'Edited by hand'))
      session.sync()
      const [doc] = only(sent.splice(0), 'doc')
      expect(doc?.doc.annotations.map((a) => a.id)).toEqual(['a1'])
      expect(doc?.doc.body[1]?.attrs['data-fdn-prop-label']).toBe('Edited by hand')
      const onDisk = parseDocument(readFileSync(file, 'utf8')).doc
      expect(onDisk.annotations.map((a) => a.id)).toEqual(['a1'])
    })

    it('adopts a chain with unrelated history instead of merging two trees', () => {
      const { open, session, sent } = start(file)
      open()
      const fresh = skeletonDocument('Board')
      fresh.body = [el('z1', { text: 'Replaced' })]
      writeFileSync(`${file}.chain`, createChain(fresh, { author: 'user:reinit', message: 'init' }).save())
      session.sync()
      const [doc] = only(sent.splice(0), 'doc')
      expect(doc).toMatchObject({ cause: { kind: 'external', author: 'user:reinit' } })
      expect(doc?.doc.body.map((n) => n.id)).toEqual(['z1'])
    })

    it('ignores its own writes and formatting-only text changes', () => {
      const { open, say, session, sent } = start(file)
      open()
      say({ t: 'commit', id: 'c', base: 1, ops: [{ op: 'set-text', id: 'n1', text: 'Mine' }], label: 'Mine' })
      session.sync()
      expect(sent).toEqual([])
      writeFileSync(file, `${readFileSync(file, 'utf8')}\n\n`)
      session.sync()
      expect(sent).toEqual([])
      expect(chainLog(file)).toHaveLength(2)
    })

    it('picks up external writes through the file watcher', async () => {
      const { open, session, sent } = start(file, { watch: true, settleMs: 20, pollMs: 200 })
      open()
      const other = loadChain(readFileSync(`${file}.chain`), { actor: 'other' })
      other.apply({ author: 'agent:watcher', message: 'Remote' }, [{ op: 'set-text', id: 'n1', text: 'Remote' }])
      writeFileSync(`${file}.chain`, other.save())
      const deadline = Date.now() + 3000
      while (only(sent, 'doc').length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
      expect(only(sent, 'doc')[0]).toMatchObject({ cause: { kind: 'external', author: 'agent:watcher' } })
      session.close()
      expect(await session.done).toBe(0)
    })
  })
})
