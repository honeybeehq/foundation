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
    expect(importChangeBlobs(a, blobs)).toBe(1)
    const saved = a.save()
    expect(importChangeBlobs(a, blobs)).toBe(0)
    expect(a.save()).toEqual(saved)
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

})
