import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parseDocument } from 'foundation-engine'
import type { FdnDocument, FdnNode } from 'foundation-engine'
import type { ServiceMessage } from 'foundation-protocol'
import { createSession } from '../src/session/session.js'

const BOARDS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'boards')
const boards = readdirSync(BOARDS).filter((name) => name.endsWith('.fdn.html'))

function firstElement(nodes: FdnNode[]): FdnNode | undefined {
  for (const node of nodes) {
    if (!node.tag.startsWith('fdn-')) return node
    const inner = firstElement(node.children)
    if (inner) return inner
  }
  return undefined
}

function declarationOrder(doc: FdnDocument): Record<string, string[]> {
  return {
    params: doc.params.map((p) => p.name),
    data: doc.data.map((d) => d.name),
    lookups: doc.lookups.map((l) => l.name),
    states: doc.states.map((s) => s.name),
    viewports: doc.viewports.map((v) => v.name),
    matrix: doc.matrix.map((m) => `${m.state}::${m.viewport}`),
    namedStyles: doc.namedStyles.map((s) => s.name),
    components: doc.components.map((c) => c.name),
  }
}

describe('session commit + undo on every board', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it.each(boards)('%s comes back byte-identical', (board) => {
    const dir = mkdtempSync(join(tmpdir(), 'fdn-session-board-'))
    dirs.push(dir)
    const file = join(dir, board)
    copyFileSync(join(BOARDS, board), file)
    copyFileSync(join(BOARDS, `${board}.chain`), `${file}.chain`)
    const original = readFileSync(file, 'utf8')

    const sent: ServiceMessage[] = []
    const session = createSession({ path: file, send: (message) => sent.push(message), watch: false })
    const say = (message: object): void => session.receive(JSON.stringify(message))
    say({ t: 'hello', protocol: '0.1', client: 'test', author: 'user:test' })
    const welcome = sent.find((m): m is Extract<ServiceMessage, { t: 'welcome' }> => m.t === 'welcome')
    expect(welcome).toBeDefined()
    expect(readFileSync(file, 'utf8')).toBe(original)

    const target = firstElement(welcome!.doc.body) as FdnNode
    say({ t: 'commit', id: 'c', base: 1, ops: [{ op: 'set-style', id: target.id, prop: 'outline-color', value: 'rgb(1, 2, 3)' }], label: 'Outline' })
    const committed = readFileSync(file, 'utf8')
    expect(committed).toContain('outline-color:rgb(1, 2, 3)')
    expect(declarationOrder(parseDocument(committed).doc)).toEqual(declarationOrder(parseDocument(original).doc))

    say({ t: 'undo', id: 'u' })
    expect(sent.filter((m) => m.t === 'result').map((m) => (m as { ok: boolean }).ok)).toEqual([true, true])
    expect(readFileSync(file, 'utf8')).toBe(original)
    session.close()
  })
})
