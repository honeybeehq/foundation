import { createHmac } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createChain, loadChain } from 'foundation-engine'
import { encodeBlob, importChangeBlobs } from '../../engine/src/chain/blob.js'
import { skeletonDocument } from '../src/commands/new.js'
import { materializeDocument, updateDocument } from '../src/disk.js'
import { DirectChanges } from '../src/sync/direct.js'

it('authenticates peers and imports only verified changes through the locked save without touching sharing state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'direct-sync-')), file = join(root, 'board.fdn.html')
  const source = createChain(skeletonDocument('Direct'), { author: 'seed', message: 'init' }, { docId: 'direct' })
  source.upgradeStorage(); materializeDocument(file, source)
  source.apply({ author: 'a', message: 'direct edit' }, [{ op: 'set-text', id: 'n1', text: 'arrived directly' }])
  const secret = 'test-workspace-secret-with-32-characters'
  const service = new DirectChanges({ listen: { host: '127.0.0.1', port: 0 }, workspaces: { w: { secret, peers: [{ nodeId: 'a', url: 'http://127.0.0.1:1' }] } } }, 'b', change => {
    if (change.docId !== 'direct' || change.product !== 'p') throw new Error('not live')
    updateDocument(file, chain => importChangeBlobs(chain, change.blobs.map(blob => Buffer.from(blob, 'hex'))), true)
  })
  try {
    const port = await service.start()
    const message = { workspace: 'w', product: 'p', docId: 'direct', nodeId: 'a', at: Date.now(), blobs: source.changes().map(c => Buffer.from(encodeBlob(c.envelope, c.bytes)).toString('hex')) }
    async function send(value = message, key = secret) {
      const body = JSON.stringify(value)
      return (await fetch(`http://127.0.0.1:${port}/changes`, { method: 'POST', body, headers: { 'x-foundation-signature': createHmac('sha256', key).update('POST\n/changes\n').update(body).digest('hex') } })).status
    }
    const before = readFileSync(`${file}.chain`)
    expect(await send(message, 'wrong-secret')).toBe(403)
    expect(await send({ ...message, nodeId: 'unknown' })).toBe(403)
    expect(await send({ ...message, workspace: 'unknown' })).toBe(403)
    expect(await send({ ...message, at: 0 })).toBe(403)
    expect(readFileSync(`${file}.chain`)).toEqual(before)
    expect(await send()).toBe(204)
    expect(loadChain(readFileSync(`${file}.chain`)).head().hash).toBe(source.head().hash)
    const times = [file, `${file}.chain`].map(path => statSync(path).mtimeMs)
    expect(await send()).toBe(204)
    expect([file, `${file}.chain`].map(path => statSync(path).mtimeMs)).toEqual(times)
    const corrupt = message.blobs.at(-1)!.slice(0, -2) + 'ff'
    expect(await send({ ...message, blobs: [corrupt] })).toBe(409)
    expect(await send({ ...message, docId: 'other' })).toBe(409)
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }) }
})
