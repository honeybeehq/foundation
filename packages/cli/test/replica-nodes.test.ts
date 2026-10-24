import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detachInstance, expandArtboardOp, loadChain, parseDocument } from 'foundation-engine'
import { runNew, skeletonDocument } from '../src/commands/new.js'
import { runIngest } from '../src/commands/ingest.js'
import { runAnnotate } from '../src/commands/annotate.js'
import { runChain } from '../src/commands/chain.js'
import { callTool } from '../src/mcp/tools.js'
import { createSession } from '../src/session/session.js'
import { captureIo } from '../src/io.js'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })))

describe('replica-safe node authoring', () => {
  it.each(['cli', 'mcp', 'session', 'implicit'] as const)('%s source insertion survives offline directory sync', async writer => {
    const dir = mkdtempSync(join(tmpdir(), 'fdn-node-replica-'))
    dirs.push(dir)
    const a = join(dir, 'a.fdn.html'), b = join(dir, 'b.fdn.html')
    expect(await runNew([a], captureIo())).toBe(0)
    copyFileSync(a, b); copyFileSync(`${a}.chain`, `${b}.chain`)
    const ids: string[] = []
    for (const [file, text] of [[a, 'Offline A'], [b, 'Offline B']]) {
      const content = readFileSync(file!, 'utf8').replace('</main>', `<p>${text}</p></main>`)
      if (writer === 'mcp') expect((await callTool('foundation_ingest', { path: file, content })).isError).not.toBe(true)
      else {
        writeFileSync(file!, content)
        if (writer === 'cli') expect(await runIngest([file!], captureIo())).toBe(0)
        if (writer === 'implicit') expect(await runAnnotate([file!, '--text', 'comment', '--node', 'n1'], captureIo())).toBe(0)
        if (writer === 'session') {
          const session = createSession({ path: file!, watch: false, send: () => {} })
          try { session.receive(JSON.stringify({ t: 'hello', protocol: '0.2', client: 'test', author: 'user:test' })) }
          finally { session.close() }
        }
      }
      const doc = loadChain(readFileSync(`${file}.chain`)).doc()
      expect(doc.body.slice(0, 2).map(node => node.id)).toEqual(['n1', 'n2'])
      ids.push(doc.body.find(node => node.text === text)!.id)
    }
    expect(ids[0]).not.toBe(ids[1])
    for (const file of [a, b, a]) expect(await runChain(['sync', file, join(dir, 'shared')], captureIo())).toBe(0)
    const left = loadChain(readFileSync(`${a}.chain`)), right = loadChain(readFileSync(`${b}.chain`))
    expect(left.doc().body.filter(node => ids.includes(node.id)).map(node => node.text).sort()).toEqual(['Offline A', 'Offline B'])
    expect(left.doc()).toEqual(right.doc())
    expect(left.verify()).toEqual({ ok: true })
  })

  it('keeps parsing existing input deterministic', () => {
    const source = '<html><body><main><p>New</p></main></body></html>'
    expect(parseDocument(source).doc).toEqual(parseDocument(source).doc)
  })

  it('detach mints disjoint new child ids while preserving the instance identity', () => {
    const doc = skeletonDocument('Detach')
    const a = detachInstance(doc, 'n2', null), b = detachInstance(doc, 'n2', null)
    expect(a.report.rootId).toBe('n2')
    expect(a.report.createdIds.length).toBeGreaterThan(0)
    expect(a.report.createdIds.some(id => b.report.createdIds.includes(id))).toBe(false)
  })

  it('upgrade fallback view records mint distinct identities', () => {
    const doc = skeletonDocument('Views')
    doc.viewports = [{ name: 'phone', width: 320, height: 640 }]
    doc.matrix = [{ state: 'default', viewport: 'phone' }]
    const op = { op: 'upgrade-artboards' as const, pageId: 'page', artboardId: 'board', name: 'Board', width: 800, height: 600, placements: [] }
    const ids = () => expandArtboardOp(doc, op).flatMap(op => op.op === 'insert-node' && op.node.tag === 'fdn-artboard-view' ? [op.node.id] : [])
    const a = ids(), b = ids()
    expect(a.length).toBeGreaterThan(0)
    expect(a.some(id => b.includes(id))).toBe(false)
  })
})
