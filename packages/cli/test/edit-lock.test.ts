import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createChain, projectDocument } from 'foundation-engine'
import { skeletonDocument } from '../src/commands/new.js'
import { editDocument } from '../src/edit.js'
import { acquireDocumentLock } from '../src/document-lock.js'
it('waits for a busy document before applying the one-shot edit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'edit-lock-')),
    file = join(root, 'board.fdn.html'),
    doc = skeletonDocument('Lock test')
  writeFileSync(file, projectDocument(doc))
  writeFileSync(file + '.chain', createChain(doc, { author: 'seed', message: 'init' }).save())
  const release = acquireDocumentLock(file)
  let released = false
  const unlock = () => {
    if (!released) {
      release()
      released = true
    }
  }
  const timer = setTimeout(unlock, 60)
  try {
    const result = await editDocument(
      file,
      [{ op: 'set-text', id: 'n1', text: 'Saved after waiting' }],
      'Edit',
      'writer'
    )
    expect(result.doc.body.find((n) => n.id === 'n1')?.text).toBe('Saved after waiting')
  } finally {
    clearTimeout(timer)
    unlock()
    rmSync(root, { recursive: true, force: true })
  }
})
