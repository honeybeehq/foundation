import { createHash } from 'node:crypto'
import { decodeOriginalUpdates, encodeOriginalUpdates } from '../src/chain/originals.js'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LoroDoc } from 'loro-crdt'
import { createChain, loadChain } from '../src/chain/chain.js'
import { computeEnvelopeHash } from '../src/chain/envelope.js'
import { baseDocument } from './chain-fixtures.js'

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/envelope-drift.json', import.meta.url), 'utf8')) as { a: string; b: string }
const pair = () => {
  const pair = [loadChain(Buffer.from(fixtures.a, 'base64')), loadChain(Buffer.from(fixtures.b, 'base64'))] as const
  pair.forEach(chain => chain.upgradeStorage())
  return pair
}
const nativeBytes = (chain: ReturnType<typeof loadChain>) => {
  const loro = (chain as unknown as { loro: LoroDoc }).loro
  const changes = [...loro.getAllChanges().values()].flat().sort((a, b) => a.lamport - b.lamport || (BigInt(a.peer) < BigInt(b.peer) ? -1 : 1))
  const c = changes.at(-1)!
  return loro.export({ mode: 'updates-in-range', spans: [{ id: { peer: c.peer, counter: c.counter }, len: c.length }] })
}

describe('immutable original change bytes', () => {
  it('preserves the exact S3 legacy fixture identity despite native dependency-order drift', () => {
    const [a, b] = pair()
    expect(a.verify()).toEqual({ ok: true }); expect(b.verify()).toEqual({ ok: true })
    expect(a.docId()).not.toBeNull()
    expect(loadChain(a.save()).log().map(change => change.hash)).toEqual(a.log().map(change => change.hash))
    const original = a.changes().at(-1)!
    expect(original.envelope.hash).toBe('aa49bb9518cda8d14fa99829dd21225d7090aedee788df5537db7c348c393c69')
    b.importUpdate(original.bytes)
    const native = nativeBytes(b)
    expect(native).not.toEqual(original.bytes)
    const e = original.envelope
    expect(computeEnvelopeHash(e.prevHash, e.author, e.message, e.specVersion, native)).toBe('b77d75280213082249c9ac43653407c48c369b323dfdd01b2b5ca1d537bc0267')
    expect(b.changes().at(-1)).toEqual(original)
    expect(b.head()).toEqual(a.head())
    expect(b.logPage().entries[0]?.hash).toBe(original.envelope.hash)
    expect(loadChain(b.save()).changes()).toEqual(a.changes())
  })

  it('carries originals through fork, merge, save/load, forwarding and a post-merge edit', () => {
    const [a, b] = pair()
    b.importUpdate(a.changes().at(-1)!.bytes)
    const c = loadChain(b.save()).fork('third-writer')
    c.apply({ author: 'user:third', message: 'after offline merge' }, [{ op: 'set-token', name: 'after-merge', value: 'yes' }])
    a.merge(c); c.merge(a)
    const reloaded = loadChain(a.save())
    expect(reloaded.changes()).toEqual(c.changes())
    expect(reloaded.doc().tokens['after-merge']).toBe('yes')
    expect(reloaded.verify()).toEqual({ ok: true })
    expect(reloaded.logPage().entries.map(e => e.hash)).toEqual([...reloaded.log()].reverse().map(e => e.hash))
    for (const change of reloaded.changes()) {
      const e = change.envelope
      expect(computeEnvelopeHash(e.prevHash, e.author, e.message, e.specVersion, change.bytes)).toBe(e.hash)
    }
  })

  it('does not expose mutable archive buffers, and rejects alternate original encodings', () => {
    const [a, b] = pair()
    const original = a.changes().at(-1)!
    b.importUpdate(original.bytes)
    const alternate = nativeBytes(b)
    const before = b.changes()
    expect(() => b.importUpdate(alternate)).toThrow('conflicting original update bytes')
    const exposed = b.changes().at(-1)!.bytes
    exposed.fill(0)
    expect(b.changes()).toEqual(before)
  })

  it('rejects missing or mismatched snapshot archive entries rather than trusting a hash override', () => {
    const [a] = pair()
    const saved = a.save(), n = new DataView(saved.buffer, saved.byteOffset).getUint32(0, true)
    const header = JSON.parse(new TextDecoder().decode(saved.subarray(4, 4 + n)))
    const pack = (header: unknown) => {
      const text = new TextEncoder().encode(JSON.stringify(header)), result = new Uint8Array(4 + text.length + saved.length - 4 - n)
      new DataView(result.buffer).setUint32(0, text.length, true); result.set(text, 4); result.set(saved.subarray(4 + n), 4 + text.length)
      return result
    }
    const missing = structuredClone(header); const missingEntries = decodeOriginalUpdates(missing.updates) as [string, string][]; missingEntries.pop(); missing.updates = encodeOriginalUpdates(missingEntries)
    expect(() => loadChain(pack(missing))).toThrow('storage integrity')
    const unrelated = createChain(baseDocument(), { author: 'user:other', message: 'other' }).save({ format: 2 })
    const m = new DataView(unrelated.buffer, unrelated.byteOffset).getUint32(0, true)
    const otherHeader = JSON.parse(new TextDecoder().decode(unrelated.subarray(4, 4 + m)))
    expect(() => loadChain(pack({ ...header, updates: otherHeader.updates }))).toThrow()
    const corrupt = structuredClone(header); corrupt.updates.data = 'AAAA'
    expect(() => loadChain(pack(corrupt))).toThrow()
  })
  it('keeps rapid commits separate and saves identical bytes across opposite merge orders', () => {
    const root = createChain(baseDocument(), { author: 'a', message: 'seed' }, { actor: 'root', docId: 'stable' })
    const a = root.fork('a'), b = root.fork('b')
    for (const [i, chain] of [a, b].entries()) {
      chain.apply({ author: 'same', message: 'one' }, [{ op: 'set-token', name: `x${i}`, value: '1' }])
      chain.apply({ author: 'same', message: 'two' }, [{ op: 'set-token', name: `y${i}`, value: '2' }])
    }
    const left = root.fork('left'), right = root.fork('right')
    left.merge(a); left.merge(b); right.merge(b); right.merge(a)
    left.anchor('z'); left.anchor('a'); right.anchor('a'); right.anchor('z')
    expect(left.changes()).toHaveLength(5)
    const bytes = left.save()
    expect(right.save()).toEqual(bytes)
    expect(loadChain(bytes).save()).toEqual(bytes)
    expect(loadChain(bytes).changes()).toEqual(left.changes())
  })

  it('rejects partial overlaps without poisoning a healthy archive', () => {
    const chain = createChain(baseDocument(), { author: 'a', message: 'seed' })
    const internal = (chain as unknown as { loro: LoroDoc }).loro
    const change = [...internal.getAllChanges().values()].flat()[0]!
    const partial = internal.export({ mode: 'updates-in-range', spans: [{ id: { peer: change.peer, counter: change.counter + 1 }, len: change.length - 1 }] })
    const before = chain.save()
    expect(() => chain.importUpdate(partial)).toThrow('overlapping change span')
    expect(chain.save()).toEqual(before)
  })

  it('detects a valid-checksum archive with the same span but changed operation contents', () => {
    const chain = createChain(baseDocument(), { author: 'a', message: 'seed' })
    chain.apply({ author: 'a', message: 'payload target' }, [{ op: 'set-token', name: 'payload', value: 'original' }])
    const internal = (chain as unknown as { loro: LoroDoc }).loro
    const schema = internal.exportJsonUpdates(undefined, undefined, false)
    const target = schema.changes.find(change => change.msg?.includes('payload target'))!
    ;(target.ops[0]!.content as { value: unknown }).value = 'tampered'
    const forged = new LoroDoc(); forged.importJsonUpdates(schema)
    const [counter, peer] = target.id.split('@')
    const c = forged.getChangeAt({ peer: peer as `${number}`, counter: Number(counter) })
    const alternate = forged.export({ mode: 'updates-in-range', spans: [{ id: { peer: c.peer, counter: c.counter }, len: c.length }] })
    const saved = chain.save({ format: 2 }), n = new DataView(saved.buffer, saved.byteOffset).getUint32(0, true)
    const header = JSON.parse(new TextDecoder().decode(saved.subarray(4, 4 + n)))
    const entries = decodeOriginalUpdates(header.updates) as [string, string][]
    entries.find(entry => entry[0] === `${c.peer}:${c.counter}:${c.length}`)![1] = Buffer.from(alternate).toString('base64')
    header.updates = encodeOriginalUpdates(entries)
    header.seal = createHash('sha256').update(JSON.stringify({ version: 2, anchors: header.anchors, updates: header.updates })).update(saved.subarray(4 + n)).digest('hex')
    const json = new TextEncoder().encode(JSON.stringify(header)), result = new Uint8Array(4 + json.length + saved.length - 4 - n)
    new DataView(result.buffer).setUint32(0, json.length, true); result.set(json, 4); result.set(saved.subarray(4 + n), 4 + json.length)
    expect(() => loadChain(result)).toThrow('chain history verification failed')
    const dir = mkdtempSync(join(tmpdir(), 'fdn-forged-copy-'))
    try {
      const original = join(dir, 'foreign.chain'), copied = join(dir, 'copied.fdn.html')
      writeFileSync(original, result); copyFileSync(original, `${copied}.chain`)
      const cli = fileURLToPath(new URL('../../cli/src/main.ts', import.meta.url))
      const run = spawnSync(process.execPath, ['--import', 'tsx', cli, 'chain', copied, 'log'], { encoding: 'utf8', env: { ...process.env, FOUNDATION_CACHE_DIR: join(dir, 'private-cache') } })
      expect(run.status).not.toBe(0)
      expect(run.stderr).toContain('chain history verification failed')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('rejects batched updates and checksum failures, and recovers out-of-order pending delivery', () => {
    const root = createChain(baseDocument(), { author: 'a', message: 'seed' })
    const writer = root.fork('sequence')
    writer.apply({ author: 'a', message: 'one' }, [{ op: 'set-token', name: 'first', value: '1' }])
    writer.apply({ author: 'a', message: 'two' }, [{ op: 'set-token', name: 'second', value: '2' }])
    const native = (writer as unknown as { loro: LoroDoc }).loro
    expect(() => root.importUpdate(native.export({ mode: 'update' }))).toThrow('one complete change')
    const changes = writer.changes(), last = changes.at(-1)!, first = changes.at(-2)!
    const corrupt = last.bytes.slice(); corrupt[20] = corrupt[20]! ^ 1
    expect(() => root.importUpdate(corrupt)).toThrow()
    root.importUpdate(last.bytes)
    expect(() => root.save()).toThrow('incomplete causal history')
    root.importUpdate(first.bytes)
    expect(loadChain(root.save()).changes()).toEqual(writer.changes())
    expect(root.verify()).toEqual({ ok: true })
  })

})
