import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createChain, projectDocument } from 'foundation-engine'
import { skeletonDocument } from '../src/commands/new.js'
import { acquireDocumentLock } from '../src/document-lock.js'
import { createSession } from '../src/session/session.js'
import { captureIo } from '../src/io.js'
import { runSync } from '../src/commands/sync.js'
import { registerDesign, closeDesign, autoOpenDesign, liveDesigns } from '../src/sync-store.js'
let dir: string | undefined
afterEach(() => { vi.unstubAllEnvs(); if (dir) rmSync(dir, { recursive: true, force: true }) })
it('preserves an explicit address on auto-open, and an edit can reopen a closed copy', () => {
  dir = mkdtempSync(join(tmpdir(), 'sync-store-')); vi.stubEnv('FOUNDATION_REPLICA_STORE', join(dir, 'store')); vi.stubEnv('FOUNDATION_SYNC_AUTO_OPEN', '1')
  const file = join(dir, 'board.fdn.html'), doc = skeletonDocument('Board')
  writeFileSync(file, projectDocument(doc)); writeFileSync(`${file}.chain`, createChain(doc, { author: 'test', message: 'init' }, { docId: 'board' }).save())
  registerDesign(file, 'explicit-workspace', 'explicit-product'); autoOpenDesign(file, () => {})
  expect(liveDesigns()).toHaveLength(1); expect(liveDesigns()[0]?.workspace).toBe('explicit-workspace')
  closeDesign(file); expect(liveDesigns()).toEqual([])
  autoOpenDesign(file, () => {}); expect(liveDesigns()).toHaveLength(1)
})
it('isolates a malformed registry entry', () => {
  dir = mkdtempSync(join(tmpdir(), 'sync-store-')); vi.stubEnv('FOUNDATION_REPLICA_STORE', dir)
  mkdirSync(join(dir, 'live')); writeFileSync(join(dir, 'live', 'bad.json'), '{bad')
  const errors: string[] = []; expect(liveDesigns(message => errors.push(message))).toEqual([]); expect(errors[0]).toContain('bad.json')
})

it('auto-registers without taking a busy document lock or mutating the chain', async () => {
  dir=mkdtempSync(join(tmpdir(),'sync-registration-'));vi.stubEnv('FOUNDATION_REPLICA_STORE',join(dir,'store'));vi.stubEnv('FOUNDATION_SYNC_AUTO_OPEN','1')
  const file=join(dir,'board.fdn.html'),doc=skeletonDocument('Board')
  const bytes=createChain(doc,{author:'test',message:'init'},{docId:'board'}).save()
  writeFileSync(file,projectDocument(doc));writeFileSync(file+'.chain',bytes)
  const release=acquireDocumentLock(file),logs:string[]=[]
  const started=performance.now()
  try{autoOpenDesign(file,message=>logs.push(message))}finally{release()}
  expect(performance.now()-started).toBeLessThan(200)
  expect(logs).toEqual([])
  expect(liveDesigns()).toHaveLength(1)
  expect(readFileSync(file+'.chain')).toEqual(Buffer.from(bytes))
  const io=captureIo();expect(await runSync(['status','--json'],io)).toBe(0)
  expect(JSON.parse(io.out[0]!)[0].status).toBe('sharing pending')
})
it('session hello auto-registers while its own transaction holds the lock', () => {
  dir=mkdtempSync(join(tmpdir(),'session-registration-'));vi.stubEnv('FOUNDATION_REPLICA_STORE',join(dir,'store'));vi.stubEnv('FOUNDATION_SYNC_AUTO_OPEN','1')
  const file=join(dir,'board.fdn.html'),doc=skeletonDocument('Board')
  writeFileSync(file,projectDocument(doc));writeFileSync(file+'.chain',createChain(doc,{author:'test',message:'init'},{docId:'board'}).save())
  const messages: any[]=[],logs:string[]=[]
  const session=createSession({path:file,watch:false,send:message=>messages.push(message),log:message=>logs.push(message)})
  try{session.receive(JSON.stringify({t:'hello',protocol:'0.2',client:'test',author:'test'}));expect(messages.some(m=>m.t==='welcome')).toBe(true);expect(logs.join('\n')).not.toContain('document is busy');expect(liveDesigns()).toHaveLength(1)}finally{session.close()}
})
