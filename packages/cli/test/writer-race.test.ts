import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChain, loadChain, projectDocument } from 'foundation-engine'
import type { FdnDocument, FdnNode } from 'foundation-engine'
import type { ServiceMessage } from 'foundation-protocol'
import { captureIo } from '../src/io.js'
import { runIngest } from '../src/commands/ingest.js'
import { callTool } from '../src/mcp/tools.js'
import { skeletonDocument } from '../src/commands/new.js'
import { defaultAuthor } from '../src/identity.js'
import { createSession, type Session } from '../src/session/session.js'

const hooks: { beforeChainWrite?: () => void; afterChainRead?: () => void; chainPath?: string } = {}

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const fire = (name: 'beforeChainWrite' | 'afterChainRead', path: unknown): void => {
    const hook = hooks[name]
    if (!hook || String(path) !== hooks.chainPath) return
    hooks[name] = undefined
    hook()
  }
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => {
    const out = actual.readFileSync(...args)
    fire('afterChainRead', args[0])
    return out
  }) as typeof actual.readFileSync
  const writeFileSync = ((...args: Parameters<typeof actual.writeFileSync>) => {
    fire('beforeChainWrite', args[0])
    return actual.writeFileSync(...args)
  }) as typeof actual.writeFileSync
  const renameSync = ((from: Parameters<typeof actual.renameSync>[0], to: Parameters<typeof actual.renameSync>[1]) => {
    fire('beforeChainWrite', to)
    return actual.renameSync(from, to)
  }) as typeof actual.renameSync
  const patched = { ...actual, readFileSync, writeFileSync, renameSync }
  return { ...patched, default: patched }
})

function bodyIds(doc: FdnDocument): string[] {
  const walk = (nodes: FdnNode[]): string[] => nodes.flatMap((node) => [node.id, ...walk(node.children)])
  return walk(doc.body)
}

function edited(): FdnDocument {
  const doc = skeletonDocument('Board')
  doc.body.push({ id: 'cagent001', tag: 'p', attrs: {}, style: {}, styleStates: {}, text: 'added by an agent', children: [] })
  return doc
}

describe('text and chain writers racing a live session', () => {
  let dir: string
  let file: string
  let chainPath: string
  let session: Session
  let sent: ServiceMessage[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fdn-writer-race-'))
    file = join(dir, 'board.fdn.html')
    chainPath = `${file}.chain`
    const doc = skeletonDocument('Board')
    writeFileSync(file, projectDocument(doc))
    writeFileSync(chainPath, createChain(doc, { author: 'user:seed', message: 'init' }).save())
    sent = []
    session = createSession({ path: file, send: (message) => sent.push(message), watch: false })
    session.receive(JSON.stringify({ t: 'hello', protocol: '0.1', client: 'test', author: 'user:session' }))
    hooks.chainPath = chainPath
  })

  afterEach(() => {
    hooks.beforeChainWrite = undefined
    hooks.afterChainRead = undefined
    session.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function chainLog(): string[] {
    return loadChain(readFileSync(chainPath)).log().map((entry) => `${entry.author}: ${entry.message}`)
  }

  function expectSingleCopy(): void {
    session.sync()
    const view = sent.filter((m): m is Extract<ServiceMessage, { t: 'doc' }> => m.t === 'doc').at(-1)
    expect(view && bodyIds(view.doc)).toEqual(['n1', 'n2', 'cagent001'])
    expect(bodyIds(loadChain(readFileSync(chainPath)).doc())).toEqual(['n1', 'n2', 'cagent001'])
  }

  it('foundation_ingest with content: the session never sees the new text before its chain', async () => {
    hooks.beforeChainWrite = () => session.sync()
    const result = await callTool('foundation_ingest', { path: file, content: projectDocument(edited()), commit: true })
    expect(result.isError).toBeFalsy()
    expectSingleCopy()
    expect(chainLog()).toEqual(['user:seed: init', `${defaultAuthor()}: ingest — 1 normalization line(s)`])
  })

  it('ingest --commit: a session that commits the same text mid-ingest is not duplicated', async () => {
    writeFileSync(file, projectDocument(edited()))
    hooks.afterChainRead = () => session.sync()
    const code = await runIngest([file, '--commit', '--author', 'agent:ingest'], captureIo())
    expect(code).toBe(0)
    expectSingleCopy()
    expect(chainLog()).toEqual(['user:seed: init', 'file: ingest'])
  })
})
