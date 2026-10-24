import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createChain, projectDocument } from 'foundation-engine'
import { skeletonDocument } from '../src/commands/new.js'
import { CataloguePublisher, confinedRelativePath, catalogueHash, catalogueRecord } from '../src/sync/catalogue.js'
let dir: string | undefined
afterEach(() => { vi.unstubAllEnvs(); if (dir) rmSync(dir, { recursive: true, force: true }) })
it('persists replica generations and retries a lost catalogue acknowledgement with the same key', async () => {
  dir = mkdtempSync(join(tmpdir(), 'sync-catalogue-')); vi.stubEnv('FOUNDATION_REPLICA_STORE', join(dir, 'store'))
  const events = join(dir, 'events.json'), bridge = join(dir, 'bridge.mjs'), file = join(dir, 'board.fdn.html')
  const doc = skeletonDocument('Board'), chain = createChain(doc, { author: 'seed', message: 'init' }, { docId: 'board' })
  writeFileSync(file, projectDocument(doc))
  writeFileSync(bridge, `import{readFileSync,writeFileSync}from'node:fs';import{createInterface}from'node:readline';const file=${JSON.stringify(events)};createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);let response;if(r.op==='hello')response={protocol:1,capabilities:{durable_idempotency:true,bounded_memory_read:true}};else{let events=[];try{events=JSON.parse(readFileSync(file,'utf8'))}catch{}let index=events.findIndex(e=>e.idempotency_key===r.idempotency_key);if(index<0){index=events.length;events.push(r);writeFileSync(file,JSON.stringify(events))}response={log:r.log,first:String(index+1),last:String(index+1),cursor:String(index+2)}}process.stdout.write(JSON.stringify({v:1,id:r.id,op:r.op,ok:true,...response})+'\\n')});`)
  const design = { docId: 'board', file, workspace: 'workspace', product: 'product', repoRoot: dir }
  const config = { binary: process.execPath, args: [bridge], node: { id: 'node-test', name: 'Test node' } }
  const publisher = new CataloguePublisher(design, 'copy', config)
  await publisher.update(chain); await publisher.update(chain)
  let records = JSON.parse(readFileSync(events, 'utf8')).map((event: { payload_hex: string }) => JSON.parse(Buffer.from(event.payload_hex, 'hex').toString()))
  expect(records).toHaveLength(1); expect(records[0]).toMatchObject({ version: 1, repoRelativePath: 'board.fdn.html', generation: 1, lastAgentEdit: null, deleted: false })
  const replica = records[0].replicaId
  chain.apply({ author: 'agent:writer', message: 'edit' }, [{ op: 'set-text', id: 'n1', text: 'new' }])
  await publisher.update(chain)
  const statePath = join(dir, 'store', 'catalogue', 'copy.json'), state = JSON.parse(readFileSync(statePath, 'utf8'))
  state.acknowledged = null; writeFileSync(statePath, JSON.stringify(state))
  await new CataloguePublisher(design, 'copy', config).update(chain)
  records = JSON.parse(readFileSync(events, 'utf8')).map((event: { payload_hex: string }) => JSON.parse(Buffer.from(event.payload_hex, 'hex').toString()))
  expect(records).toHaveLength(2); expect(records[1]).toMatchObject({ replicaId: replica, generation: 2, headHash: chain.head().hash })
  expect(catalogueHash(records[1])).toBe(JSON.parse(readFileSync(statePath, 'utf8')).acknowledged)
})
it('rejects paths outside the registered repository', () => {
  dir = mkdtempSync(join(tmpdir(), 'catalogue-path-')); const repo = join(dir, 'repo'); mkdirSync(repo)
  const outside = join(dir, 'outside.fdn.html'); writeFileSync(outside, '')
  expect(() => confinedRelativePath(repo, outside)).toThrow('confined')
  const link = join(repo, 'escape.fdn.html'); symlinkSync(outside, link)
  expect(() => confinedRelativePath(repo, link)).toThrow('confined')
})

it('bounds a large catalogue title', () => {
  dir = mkdtempSync(join(tmpdir(), 'catalogue-title-')); const file = join(dir, 'board.fdn.html'); writeFileSync(file, '')
  const chain = createChain(skeletonDocument('x'.repeat(10000)), { author: 'test', message: 'init' }, { docId: 'title' })
  const record = catalogueRecord({ docId: 'title', file, workspace: 'w', product: 'p', repoRoot: dir }, chain, 'replica', 1, { id: 'node', name: 'Node' })
  expect(record.title).toHaveLength(4096)
})
