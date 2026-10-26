import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadChain } from 'foundation-engine'
import { loadChain as cachedLoadChain } from '../src/chain-cache.js'
import { OriginalUpdates } from '../../engine/src/chain/originals.js'
import type { WireServiceMessage } from 'foundation-protocol'
import { runNew } from '../src/commands/new.js'
import { runEdit } from '../src/commands/edit.js'
import { runSync } from '../src/commands/sync.js'
import { runChain } from '../src/commands/chain.js'
import { closeDesign } from '../src/sync-store.js'
import { runDoctor } from '../src/commands/doctor.js'
import { runtimeVersion } from '../src/runtime-version.js'
import { createSession } from '../src/session/session.js'
import { captureIo } from '../src/io.js'

function format(file: string): 1 | 2 {
  const bytes = readFileSync(`${file}.chain`), n = bytes.readUInt32LE(0)
  return Array.isArray(JSON.parse(bytes.subarray(4, 4 + n).toString())) ? 1 : 2
}

describe('opt-in chain storage', () => {
  let dir: string, file: string
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fdn-format-')); file = join(dir, 'board.fdn.html')
    vi.stubEnv('FOUNDATION_CHAIN_FORMAT', '1'); vi.stubEnv('FOUNDATION_SYNC_AUTO_OPEN', '0')
    vi.stubEnv('FOUNDATION_REPLICA_STORE', join(dir, 'replicas'))
    expect(await runNew([file], captureIo())).toBe(0)
  })
  afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }) })
  const edit = (file: string, value: string) => runEdit([file, '--ops', JSON.stringify([{ op: 'set-token', name: 'test', value }])], captureIo())

  it('keeps local CLI and session writes in v1 with stable hashes and bytes', async () => {
    expect(format(file)).toBe(1)
    expect(await edit(file, 'local')).toBe(0)
    expect(format(file)).toBe(1)
    const a = loadChain(readFileSync(`${file}.chain`)), bytes = a.save()
    expect(a.storageFormat()).toBe(1); expect(a.verify()).toEqual({ ok: true })
    expect(loadChain(bytes).save()).toEqual(bytes)
    expect(loadChain(bytes).log()).toEqual(a.log())
    const session = createSession({ path: file, watch: false, send: () => {} })
    try {
      session.receive(JSON.stringify({ t: 'hello', protocol: '0.2', client: 'old-client', author: 'a' }))
      expect(await edit(file, 'another-local-writer')).toBe(0)
      session.receive(JSON.stringify({ t: 'commit', id: 'c', base: 1, label: 'local', ops: [{ op: 'set-token', name: 'session', value: 'local' }] }))
      expect(format(file)).toBe(1)
    } finally { session.close() }
  })

  it('upgrades on sync open without changing history and never downgrades on close', async () => {
    const before = loadChain(readFileSync(`${file}.chain`)).log()
    expect(await runSync(['open', file], captureIo())).toBe(0)
    expect(format(file)).toBe(2)
    expect(loadChain(readFileSync(`${file}.chain`)).log()).toEqual(before)
    closeDesign(file)
    expect(await edit(file, 'after-close')).toBe(0)
    expect(format(file)).toBe(2)
    const chain = loadChain(readFileSync(`${file}.chain`))
    expect(() => chain.save({ format: 1 })).toThrow('cannot be downgraded')
    expect(loadChain(chain.save()).save()).toEqual(chain.save())
  })

  it('honors explicit format and auto-sync opt-ins', async () => {
    vi.stubEnv('FOUNDATION_CHAIN_FORMAT', '2')
    expect(await edit(file, 'explicit')).toBe(0); expect(format(file)).toBe(2)
    const other = join(dir, 'other.fdn.html')
    vi.stubEnv('FOUNDATION_CHAIN_FORMAT', '1'); vi.stubEnv('FOUNDATION_SYNC_AUTO_OPEN', '1')
    expect(await runNew([other], captureIo())).toBe(0); expect(format(other)).toBe(2)
  })

  it('advertises actual/write formats and rejects only explicitly incompatible clients', async () => {
    const messages: WireServiceMessage[] = []
    const session = createSession({ path: file, watch: false, send: message => messages.push(message) })
    try {
      session.receive(JSON.stringify({ t: 'hello', protocol: '0.2', client: 'v1', author: 'a', chainFormats: [1] }))
      expect(messages.find(m => m.t === 'welcome')).toMatchObject({ chainFormat: 1, writeChainFormat: 1, chainReadOnly: false, runtime: { chainFormats: [1, 2], defaultChainFormat: 1 } })
      expect(await runSync(['open', file], captureIo())).toBe(0)
      messages.length = 0
      session.receive(JSON.stringify({ t: 'commit', id: 'blocked', base: 1, label: 'no', ops: [{ op: 'set-token', name: 'blocked', value: 'no' }] }))
      expect(messages.find(m => m.t === 'doc')).toMatchObject({ chainFormat: 2, chainReadOnly: true, readOnly: expect.stringContaining('cannot write chain format 2') })
      expect(messages.find(m => m.t === 'result')).toMatchObject({ ok: false, message: expect.stringContaining('cannot write chain format 2') })
      expect(loadChain(readFileSync(`${file}.chain`)).doc().tokens.blocked).toBeUndefined()
    } finally { session.close() }
    const legacy = createSession({ path: file, watch: false, send: message => messages.push(message) })
    try {
      messages.length = 0
      legacy.receive(JSON.stringify({ t: 'hello', protocol: '0.2', client: 'unchanged', author: 'a' }))
      expect(messages.find(m => m.t === 'welcome')).toMatchObject({ chainFormat: 2, writeChainFormat: 2, chainReadOnly: false })
    } finally { legacy.close() }
  })

  it('keeps a read-only session read-only without auto-registering or upgrading', () => {
    vi.stubEnv('FOUNDATION_SYNC_AUTO_OPEN', '1')
    const before = readFileSync(`${file}.chain`), messages: WireServiceMessage[] = []
    const session = createSession({ path: file, watch: false, send: message => messages.push(message) })
    try {
      session.receive(JSON.stringify({ t: 'hello', protocol: '0.2', client: 'reader', author: 'a', mode: 'read' }))
      expect(messages.find(m => m.t === 'welcome')).toMatchObject({ chainFormat: 1, readOnly: expect.stringContaining('read-only session') })
      session.receive(JSON.stringify({ t: 'commit', id: 'no', base: 1, label: 'no', ops: [{ op: 'set-token', name: 'no', value: 'no' }] }))
      expect(messages.find(m => m.t === 'result')).toMatchObject({ ok: false })
      expect(readFileSync(`${file}.chain`)).toEqual(before)
      expect(existsSync(join(dir, 'replicas', 'live'))).toBe(false)
    } finally { session.close() }
  })

  it('reports the format restriction on a writable v2 welcome', async () => {
    expect(await runSync(['open', file], captureIo())).toBe(0)
    const messages: WireServiceMessage[] = []
    const session = createSession({ path: file, watch: false, send: message => messages.push(message) })
    try {
      session.receive(JSON.stringify({ t: 'hello', protocol: '0.2', client: 'v1-client', author: 'a', chainFormats: [1] }))
      expect(messages.find(m => m.t === 'welcome')).toMatchObject({ chainFormat: 2, chainReadOnly: true, readOnly: expect.stringContaining('cannot write chain format 2') })
    } finally { session.close() }
  })

  it('keeps original v2 bytes and the verified load cache through a durable receipt write', async () => {
    vi.stubEnv('FOUNDATION_CACHE_DIR', join(dir, 'cache'))
    expect(await runSync(['open', file], captureIo())).toBe(0)
    const before = loadChain(readFileSync(`${file}.chain`)).changes()
    const messages: WireServiceMessage[] = []
    const session = createSession({ path: file, watch: false, send: message => messages.push(message) })
    try {
      session.receive(JSON.stringify({ t: 'hello', protocol: '0.2', client: 'writer', author: 'a' }))
      session.receive(JSON.stringify({ t: 'commit', id: 'durable', base: 1, durable: true, label: 'durable', ops: [{ op: 'set-token', name: 'durable', value: 'yes' }] }))
      expect(messages.find(m => m.t === 'result')).toMatchObject({ ok: true, head: { hash: expect.any(String) }, nodeIds: [] })
      expect(format(file)).toBe(2)
      const saved = readFileSync(`${file}.chain`), chain = loadChain(saved)
      const header = JSON.parse(saved.subarray(4, 4 + saved.readUInt32LE(0)).toString())
      expect(existsSync(join(dir, 'cache', 'verified-chains-v2', header.seal))).toBe(true)
      for (const original of before) expect(chain.changes().find(c => c.envelope.hash === original.envelope.hash)?.bytes).toEqual(original.bytes)
      const validate = vi.spyOn(OriginalUpdates.prototype, 'validate')
      try { expect(cachedLoadChain(saved).storageFormat()).toBe(2); expect(validate).not.toHaveBeenCalled() } finally { validate.mockRestore() }
    } finally { session.close() }
  })

  it('exposes writer capabilities and default policy through version and doctor', async () => {
    expect(runtimeVersion()).toMatchObject({ chainFormats: [1, 2], defaultChainFormat: 1 })
    vi.stubEnv('HOME', join(dir, 'home')); vi.stubEnv('PATH', '')
    const io = captureIo(); expect(await runDoctor(['--inventory', '--json'], io)).toBe(0)
    expect(JSON.parse(io.out.join('\n'))).toMatchObject({ chainFormats: [1, 2], defaultChainFormat: 1 })
    vi.stubEnv('FOUNDATION_CHAIN_FORMAT', '2')
    expect(runtimeVersion().defaultChainFormat).toBe(2)
  })

  it('warns and dirties a tracked v1 file once on the first explicit sync', async () => {
    const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
    git('init', '-q'); git('config', 'user.name', 'test'); git('config', 'user.email', 'test@example.org')
    git('add', 'board.fdn.html', 'board.fdn.html.chain'); git('commit', '-qm', 'v1')
    const first = captureIo()
    expect(await runChain(['sync', file, join(dir, 'shared')], first)).toBe(0)
    expect(format(file)).toBe(2)
    expect(first.err.filter(line => line.includes('older Foundation builds cannot read this file'))).toHaveLength(1)
    expect(git('status', '--porcelain', '--', 'board.fdn.html.chain')).toContain('M board.fdn.html.chain')
    git('add', 'board.fdn.html.chain'); git('commit', '-qm', 'explicit format cutover')
    const second = captureIo()
    expect(await runChain(['sync', file, join(dir, 'shared')], second)).toBe(0)
    expect(second.err.some(line => line.includes('upgraded to chain format 2'))).toBe(false)
    expect(git('status', '--porcelain', '--', 'board.fdn.html.chain')).toBe('')
  })

  it('preserves v2 identities through real directory sync after opt-in', async () => {
    const other = join(dir, 'other.fdn.html')
    copyFileSync(file, other); copyFileSync(`${file}.chain`, `${other}.chain`)
    expect(await edit(file, 'A')).toBe(0); expect(await edit(other, 'B')).toBe(0)
    for (const path of [file, other]) expect(await runSync(['open', path], captureIo())).toBe(0)
    const shared = join(dir, 'shared')
    for (const path of [file, other, file]) expect(await runChain(['sync', path, shared], captureIo())).toBe(0)
    expect(readFileSync(`${file}.chain`)).toEqual(readFileSync(`${other}.chain`))
    expect(loadChain(readFileSync(`${file}.chain`)).verify()).toEqual({ ok: true })
  })
})
