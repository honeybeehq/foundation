import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createChain } from 'foundation-engine'
import { skeletonDocument } from '../src/commands/new.js'
import { encodeBlob, restoreChangeBlobs } from '../../engine/src/chain/blob.js'
import { materializeDocument } from '../src/disk.js'
import { materializePath } from '../src/sync/materialize.js'
let root: string | undefined
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }) })
const seed = () => createChain(skeletonDocument('Restore'), { author: 'seed', message: 'init' }, { docId: 'restore' })
it('restores exact bytes after divergent history without creating a new genesis', () => {
  const a = seed(), b = a.fork('b')
  a.apply({ author: 'a', message: 'a' }, [{ op: 'set-text', id: 'n1', text: 'A' }])
  b.apply({ author: 'b', message: 'b' }, [{ op: 'set-text', id: 'n2', text: 'B' }]); a.merge(b)
  a.apply({ author: 'a', message: 'merged edit' }, [{ op: 'set-text', id: 'n1', text: 'merged' }])
  const blobs = a.changes().map(change => encodeBlob(change.envelope, change.bytes))
  const restored = restoreChangeBlobs([...blobs, blobs[0]!], 'restore')
  expect(restored.verify().ok).toBe(true); expect(restored.save()).toEqual(a.save())
  expect(() => restoreChangeBlobs(blobs.slice(1), 'restore')).toThrow()
  expect(() => restoreChangeBlobs(blobs, 'foreign')).toThrow('identity mismatch')
})
it('refuses foreign and untracked targets, and merges matching local edits under the save lock', () => {
  root = mkdtempSync(join(tmpdir(), 'materialize-')); const file = join(root, 'board.fdn.html'), chain = seed()
  materializeDocument(file, chain)
  const local = chain.fork('local'); local.apply({ author: 'local', message: 'local' }, [{ op: 'set-text', id: 'n2', text: 'local' }])
  materializeDocument(file, local)
  const remote = chain.fork('remote'); remote.apply({ author: 'remote', message: 'remote' }, [{ op: 'set-text', id: 'n1', text: 'remote' }])
  const merged = materializeDocument(file, remote)
  expect(merged.doc().body.find(node => node.id === 'n2')?.text).toBe('local')
  expect(merged.doc().body.find(node => node.id === 'n1')?.text).toBe('remote')
  expect(() => materializeDocument(file, seed())).toThrow('unrelated history')
  const before = readFileSync(file), beforeChain = readFileSync(`${file}.chain`)
  const foreign = createChain(skeletonDocument('Foreign'), { author: 'f', message: 'init' }, { docId: 'foreign' })
  expect(() => materializeDocument(file, foreign)).toThrow('path-conflict')
  expect(readFileSync(file)).toEqual(before); expect(readFileSync(`${file}.chain`)).toEqual(beforeChain)
  const untracked = join(root, 'untracked.fdn.html'); writeFileSync(untracked, 'local work')
  expect(() => materializeDocument(untracked, chain)).toThrow('untracked')
  expect(readFileSync(untracked, 'utf8')).toBe('local work')
})
it('confines paths, including symlink escapes', () => {
  root = mkdtempSync(join(tmpdir(), 'materialize-path-')); const repo = join(root, 'repo'); mkdirSync(repo)
  expect(materializePath(repo, 'boards/new.fdn.html')).toBe(join(repo, 'boards/new.fdn.html'))
  expect(() => materializePath(repo, '../escape.fdn.html')).toThrow()
  symlinkSync(root, join(repo, 'escape')); expect(() => materializePath(repo, 'escape/file.fdn.html')).toThrow('symlink')
})
