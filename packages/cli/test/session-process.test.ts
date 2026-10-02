import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadChain, parseDocument } from 'foundation-engine'
import type { FdnNode } from 'foundation-engine'
import { parseServiceMessage } from 'foundation-protocol'
import type { ClientMessage, ServiceMessage } from 'foundation-protocol'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI_ROOT = join(HERE, '..')
const MAIN_TS = join(CLI_ROOT, 'src', 'main.ts')
const LAUNCHER = join(CLI_ROOT, 'bin', 'session.mjs')
const ENTRY_POINTS: [string, string[]][] = [
  ['source through tsx', ['--import', 'tsx', MAIN_TS]],
  ['bundled launcher', [LAUNCHER]],
]
const BOARD = join(HERE, '..', '..', '..', 'boards', 'tracks-pane.fdn.html')

type Of<T extends ServiceMessage['t']> = Extract<ServiceMessage, { t: T }>

class Client {
  readonly stdoutLines: string[] = []
  private readonly inbox: ServiceMessage[] = []
  private waiters: (() => void)[] = []

  constructor(readonly child: ChildProcessWithoutNullStreams) {
    createInterface({ input: child.stdout }).on('line', (line) => {
      this.stdoutLines.push(line)
      const message = parseServiceMessage(line)
      if (message) this.inbox.push(message)
      for (const wake of this.waiters.splice(0)) wake()
    })
  }

  send(message: ClientMessage): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  async next<T extends ServiceMessage['t']>(t: T, where: (message: Of<T>) => boolean = () => true, timeout = 15000): Promise<Of<T>> {
    const deadline = Date.now() + timeout
    for (;;) {
      const index = this.inbox.findIndex((message) => message.t === t && where(message as Of<T>))
      if (index !== -1) return this.inbox.splice(0, index + 1).at(-1) as Of<T>
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${t}; inbox: ${this.inbox.map((m) => m.t).join(',')}`)
      await new Promise<void>((wake) => {
        this.waiters.push(wake)
        setTimeout(wake, 100)
      })
    }
  }
}

function firstElement(nodes: FdnNode[]): FdnNode | undefined {
  for (const node of nodes) {
    if (!node.tag.startsWith('fdn-') && node.text === undefined) return node
    const inner = firstElement(node.children)
    if (inner) return inner
  }
  return undefined
}

describe.each(ENTRY_POINTS)('foundation session (real stdio child process, %s)', (_name, entry) => {
  let dir: string
  let file: string
  let client: Client

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fdn-session-e2e-'))
    file = join(dir, 'tracks-pane.fdn.html')
    copyFileSync(BOARD, file)
    copyFileSync(`${BOARD}.chain`, `${file}.chain`)
    client = new Client(spawn(process.execPath, [...entry, 'session', file, '--author', 'user:e2e'], { cwd: CLI_ROOT }))
  })

  afterEach(() => {
    client.child.kill()
    rmSync(dir, { recursive: true, force: true })
  })

  it('edits, undoes, and picks up a second writer over stdio', async () => {
    client.send({ t: 'hello', protocol: '0.1', client: 'e2e', author: '' })
    const welcome = await client.next('welcome')
    expect(welcome).toMatchObject({ rev: 1, chain: true, created: false, path: file })

    client.send({ t: 'view', states: [null], components: false })
    expect((await client.next('baked')).html).toContain('<!doctype html>')

    const target = firstElement(welcome.doc.body) as FdnNode
    client.send({ t: 'commit', id: 'c1', base: 1, ops: [{ op: 'set-style', id: target.id, prop: 'outline-color', value: 'rgb(1, 2, 3)' }], label: 'Outline' })
    expect(await client.next('doc')).toMatchObject({ rev: 2, cause: { kind: 'commit', id: 'c1', author: 'user:e2e' } })
    expect((await client.next('baked')).html).toContain(`data-fdn-id="${target.id}"`)
    expect(await client.next('result')).toEqual({ t: 'result', id: 'c1', ok: true, rev: 2 })
    expect(readFileSync(file, 'utf8')).toContain('outline-color:rgb(1, 2, 3)')

    client.send({ t: 'undo', id: 'u1' })
    expect(await client.next('doc')).toMatchObject({ rev: 3, cause: { kind: 'undo', id: 'u1' } })
    expect(await client.next('result')).toMatchObject({ ok: true, rev: 3 })
    expect(readFileSync(file, 'utf8')).not.toContain('outline-color:rgb(1, 2, 3)')

    const annotate = spawnSync(process.execPath, ['--import', 'tsx', MAIN_TS, 'annotate', file, '--text', 'from the second writer', '--node', target.id, '--author', 'agent:second'], { cwd: CLI_ROOT, encoding: 'utf8' })
    expect(annotate.status, annotate.stderr).toBe(0)
    const external = await client.next('doc', (message) => message.cause.kind === 'external')
    expect(external.cause).toEqual({ kind: 'external', author: 'agent:second' })
    expect(external.doc.annotations.map((a) => a.text)).toContain('from the second writer')

    client.send({ t: 'commit', id: 'c2', base: external.rev, ops: [{ op: 'set-text', id: target.id, text: 'after' }], label: 'Text' })
    expect(await client.next('result')).toMatchObject({ id: 'c2', ok: true })

    client.send({ t: 'log', id: 'l1', limit: 4 })
    const log = await client.next('log')
    expect(log.entries.map((entry) => `${entry.author}: ${entry.message}`)).toEqual([
      'user:e2e: Text',
      'agent:second: annotate: from the second writer',
      'user:e2e: Undo Outline',
      'user:e2e: Outline',
    ])

    const onDisk = loadChain(readFileSync(`${file}.chain`)).log().map((entry) => entry.message)
    expect(onDisk.slice(-4)).toEqual(['Outline', 'Undo Outline', 'annotate: from the second writer', 'Text'])
    expect(parseDocument(readFileSync(file, 'utf8')).doc.annotations.map((a) => a.text)).toContain('from the second writer')

    client.child.stdin.end()
    const code = await new Promise<number | null>((resolveExit) => client.child.on('exit', resolveExit))
    expect(code).toBe(0)
    expect(client.stdoutLines.every((line) => parseServiceMessage(line) !== null)).toBe(true)
  }, 60000)
})
