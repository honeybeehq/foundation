import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createChain, loadChain } from 'foundation-engine'
import { encodeBlob, importChangeBlobs } from '../../engine/src/chain/blob.js'
import { skeletonDocument } from '../src/commands/new.js'
import { materializeDocument, updateDocument } from '../src/disk.js'
import { registerDesign } from '../src/sync-store.js'
import { publishablePrefix, serveSync } from '../src/sync/daemon.js'
import { DirectChanges } from '../src/sync/direct.js'

it('keeps a held direct parent before its descendants so independent followers never block', () => {
  const base = createChain(skeletonDocument('Causal'), { author: 'seed', message: 'init' }, { docId: 'causal' })
  const a = base.fork('a'), b = base.fork('b'), c = base.fork('c')
  a.apply({ author: 'a', message: 'held parent' }, [{ op: 'set-text', id: 'n1', text: 'parent' }])
  const parent = a.changes().at(-1)!
  b.merge(a)
  b.apply({ author: 'b', message: 'child' }, [{ op: 'set-text', id: 'n2', text: 'child' }])
  const known = new Set(base.changes().map(change => change.envelope.hash))
  const unshared = b.changes().filter(change => !known.has(change.envelope.hash)), held = new Map([[parent.envelope.hash, 100]])
  expect(publishablePrefix(unshared, held, 99)).toEqual([])
  // This was the unsafe filter: a fresh follower cannot import the child first.
  expect(() => importChangeBlobs(c, unshared.slice(1).map(change => encodeBlob(change.envelope, change.bytes)))).toThrow()
  const fallback = publishablePrefix(unshared, held, 100)
  for (const follower of [a, c]) for (const change of fallback) expect(() => importChangeBlobs(follower, [encodeBlob(change.envelope, change.bytes)])).not.toThrow()
  expect(c.head().hash).toBe(b.head().hash)
  // If the sender acknowledges first, its parent is already shared; only the child uploads.
  known.add(parent.envelope.hash)
  const afterAck = publishablePrefix(b.changes().filter(change => !known.has(change.envelope.hash)), held, 99)
  expect(afterAck.map(change => change.envelope.message)).toEqual(['child'])
})

it('dispatches successive saved changes while a prior Comb append is still awaiting its receipt', async () => {
  const root = mkdtempSync(join(tmpdir(), 'direct-scheduling-')), previous = process.env.FOUNDATION_REPLICA_STORE
  process.env.FOUNDATION_REPLICA_STORE = join(root, 'replicas')
  const a = join(root, 'a.fdn.html'), b = join(root, 'b.fdn.html'), started = join(root, 'started'), ack = join(root, 'ack'), script = join(root, 'bridge.cjs')
  const chain = createChain(skeletonDocument('Scheduling'), { author: 'seed', message: 'init' }, { docId: 'scheduling' })
  chain.upgradeStorage(); materializeDocument(a, chain); materializeDocument(b, chain)
  registerDesign(a, 'w', 'p')
  // Supported wire contract with an intentionally slow append boundary.
  writeFileSync(script, `const fs=require('fs'); const rl=require('readline').createInterface({input:process.stdin}); const reply=(r,x)=>process.stdout.write(JSON.stringify({v:1,id:r.id,op:r.op,ok:true,...x})+'\\n'); rl.on('line',l=>{const r=JSON.parse(l);if(r.op==='hello')reply(r,{protocol:1,capabilities:{durable_idempotency:true,bounded_memory_read:true}});else if(r.op==='read')reply(r,{log:r.log,events:[],next_cursor:r.cursor});else if(r.op==='append'){fs.writeFileSync(process.argv[2],'started');setTimeout(()=>{fs.writeFileSync(process.argv[3],'ack');reply(r,{log:r.log,first:'1',last:'1',cursor:'2'})},1800)}});rl.on('close',()=>process.exit(0));`)
  const secret = 'scheduling-test-secret-at-least-32-characters'
  const receiver = new DirectChanges({ listen: { host: '127.0.0.1', port: 0 }, workspaces: { w: { secret, peers: [{ nodeId: 'origin', url: 'http://127.0.0.1:1' }] } } }, 'target', change => updateDocument(b, current => { importChangeBlobs(current, change.blobs.map(blob => Buffer.from(blob, 'hex'))) }, true))
  const port = await receiver.start(), controller = new AbortController()
  const done = serveSync({ binary: process.execPath, args: [script, started, ack], node: { id: 'origin', name: 'Origin' }, direct: { listen: { host: '127.0.0.1', port: 0 }, workspaces: { w: { secret, peers: [{ nodeId: 'target', url: `http://127.0.0.1:${port}` }] } } } }, controller.signal, () => {})
  const until = async (condition: () => boolean) => { const deadline = Date.now() + 1200; while (!condition()) { if (Date.now() >= deadline) throw new Error('condition timed out'); await new Promise(resolve => setTimeout(resolve, 10)) } }
  try {
    await until(() => existsSync(started))
    for (const text of ['first', 'second']) {
      updateDocument(a, current => current.apply({ author: 'origin', message: text }, [{ op: 'set-text', id: 'n1', text }]))
      const hash = loadChain(readFileSync(`${a}.chain`)).head().hash
      await until(() => loadChain(readFileSync(`${b}.chain`)).head().hash === hash)
      expect(existsSync(ack)).toBe(false)
    }
  } finally { controller.abort(); await done; await receiver.close(); if (previous === undefined) delete process.env.FOUNDATION_REPLICA_STORE; else process.env.FOUNDATION_REPLICA_STORE = previous; rmSync(root, { recursive: true, force: true }) }
}, 10000)
