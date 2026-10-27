import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createChain, loadChain } from '../src/chain/chain.js'
import { encodeBlob, decodeBlob, importChangeBlobs } from '../src/chain/blob.js'
import { skeletonDocument } from '../../cli/src/commands/new.js'

function seed() { return createChain(skeletonDocument('Sync'), { author: 'seed', message: 'init' }, { actor: 'seed', docId: 'sync-test' }) }
describe('shared change wire boundary', () => {
  it('rejects short, invalid length, corrupted hash and invalid JSON frames', () => {
    const change = seed().changes()[0]!
    const blob = encodeBlob(change.envelope, change.bytes)
    expect(decodeBlob(blob).envelope.hash).toBe(change.envelope.hash)
    for (const bytes of [blob.subarray(0, 3), blob.subarray(0, 10), Uint8Array.from([0, 0, 0, 0, 1])]) expect(() => decodeBlob(bytes)).toThrow()
    const corrupt = blob.slice(); corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1
    expect(() => decodeBlob(corrupt)).toThrow('hash mismatch')
  })
  it('imports complete concurrent branches and makes duplicate delivery inert', () => {
    const a = seed(), b = a.fork('remote')
    a.apply({ author: 'a', message: 'local' }, [{ op: 'set-text', id: 'n1', text: 'A' }])
    b.apply({ author: 'b', message: 'remote' }, [{ op: 'set-text', id: 'n2', text: 'B' }])
    const blobs = b.changes().map(c => encodeBlob(c.envelope, c.bytes))
    const importedStages: string[] = []
    expect(importChangeBlobs(a, blobs, stage => importedStages.push(stage))).toBe(1)
    expect(importedStages).toContain('verify')
    const saved = a.save()
    const stages: string[] = []
    expect(importChangeBlobs(a, blobs, stage => stages.push(stage))).toBe(0)
    expect(stages).toEqual(['decode'])
    expect(a.save()).toEqual(saved)
    const corrupt = blobs[0]!.slice(); corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1
    expect(() => importChangeBlobs(a, [corrupt])).toThrow('hash mismatch')
  })
  it('rejects missing history and foreign document without changing the live chain', () => {
    const a = seed(), b = a.fork('remote')
    b.apply({ author: 'b', message: 'one' }, [{ op: 'set-text', id: 'n1', text: 'one' }])
    b.apply({ author: 'b', message: 'two' }, [{ op: 'set-text', id: 'n1', text: 'two' }])
    const last = b.changes().at(-1)!, before = a.save()
    expect(() => importChangeBlobs(a, [encodeBlob(last.envelope, last.bytes)])).toThrow()
    const foreign = createChain(skeletonDocument('Other'), { author: 'x', message: 'init' }, { actor: 'other', docId: 'other' })
    expect(() => importChangeBlobs(a, foreign.changes().map(c => encodeBlob(c.envelope, c.bytes)))).toThrow()
    expect(loadChain(a.save()).doc()).toEqual(loadChain(before).doc())
  })
  it('rejects a Loro update with a known envelope parent but another missing dependency', () => {
    const base = seed(), b = base.fork('b'), c = base.fork('c')
    b.apply({ author: 'b', message: 'branch-b' }, [{ op: 'set-text', id: 'n1', text: 'b' }])
    c.apply({ author: 'c', message: 'branch-c' }, [{ op: 'set-text', id: 'n2', text: 'c' }])
    const branches = [...b.changes(), ...c.changes()]
    b.merge(c)
    b.apply({ author: 'b', message: 'final' }, [{ op: 'set-text', id: 'n1', text: 'final' }])
    const final = b.changes().find(change => change.envelope.message === 'final')!
    const parent = branches.find(change => change.envelope.hash === final.envelope.prevHash)!
    importChangeBlobs(base, [encodeBlob(parent.envelope, parent.bytes)])
    const before = base.save()
    expect(() => importChangeBlobs(base, [encodeBlob(final.envelope, final.bytes)])).toThrow('incomplete causal')
    expect(base.save()).toEqual(before)
  })

  it('keeps blob bytes and hashes identical on both replicas after each makes a post-merge change', () => {
    const fixtures = JSON.parse(readFileSync(new URL('./fixtures/envelope-drift.json', import.meta.url), 'utf8')) as { a: string; b: string }
    let a = loadChain(Buffer.from(fixtures.a, 'base64')), b = loadChain(Buffer.from(fixtures.b, 'base64'))
    importChangeBlobs(b, a.changes().map(change => encodeBlob(change.envelope, change.bytes)))
    a = a.fork('blob-post-merge-a'); b = b.fork('blob-post-merge-b')
    a.apply({ author: 'a', message: 'after merge A' }, [{ op: 'set-text', id: 'n1', text: 'A after merge' }])
    b.apply({ author: 'b', message: 'after merge B' }, [{ op: 'set-text', id: 'n2', text: 'B after merge' }])
    const fromA = a.changes().map(change => encodeBlob(change.envelope, change.bytes))
    const fromB = b.changes().map(change => encodeBlob(change.envelope, change.bytes))
    importChangeBlobs(a, fromB); importChangeBlobs(b, fromA)
    a = loadChain(a.save()); b = loadChain(b.save())
    expect(a.changes()).toEqual(b.changes())
    for (const change of a.changes()) {
      const encoded = encodeBlob(change.envelope, change.bytes), decoded = decodeBlob(encoded)
      expect(decoded.envelope.hash).toBe(change.envelope.hash)
      expect(decoded.bytes).toEqual(change.bytes)
      expect(encodeBlob(decoded.envelope, decoded.bytes)).toEqual(encoded)
      const peer = b.changes().find(other => other.envelope.hash === change.envelope.hash)!
      expect(encodeBlob(peer.envelope, peer.bytes)).toEqual(encoded)
    }
  })

})
