import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { createChain, loadChain } from 'foundation-engine'
import type { WireServiceMessage } from 'foundation-protocol'
import { skeletonDocument } from '../src/commands/new.js'
import { materializeDocument, persistDocument } from '../src/disk.js'
import { initializeActivityJournal, closeActivityJournal, recordActivity, flushActivityJournal } from '../src/sync/local-model.js'
import { historyOrigins, rememberOrigin } from '../src/history-origin.js'
import { createSession } from '../src/session/session.js'
import { runChain } from '../src/commands/chain.js'
import { captureIo } from '../src/io.js'
let dir:string
function fixture(){dir=mkdtempSync(join(tmpdir(),'history-origin-'));vi.stubEnv('FOUNDATION_REPLICA_STORE',join(dir,'replicas'));return join(dir,'board.fdn.html')}
afterEach(()=>{vi.unstubAllEnvs();if(dir)rmSync(dir,{recursive:true,force:true})})
it('only freshly authored commits are local; imports and matching machine labels are not',()=>{
  const file=fixture(),chain=createChain(skeletonDocument('Origin'),{author:'human',message:'init',originNode:'this-machine'},{docId:'origin'})
  const bytes=chain.save();expect(chain.takeAuthoredChanges()).toEqual([chain.head()]);expect(chain.takeAuthoredChanges()).toEqual([]);expect(chain.save()).toEqual(bytes)
  const imported=loadChain(bytes);expect(imported.takeAuthoredChanges()).toEqual([])
  materializeDocument(file,imported)
  expect(historyOrigins('origin',imported.log())[0]).toMatchObject({originNode:'this-machine',originAssurance:null})
  const local=loadChain(readFileSync(file+'.chain'));local.apply({author:'human',message:'local',originNode:'this-machine'},[{op:'set-token',name:'local',value:'yes'}]);persistDocument(file,local)
  const loaded=loadChain(readFileSync(file+'.chain'))
  expect(loaded.verify().ok).toBe(true)
  expect(historyOrigins('origin',loaded.log()).map(e=>e.originAssurance)).toEqual([null,'local'])
  rememberOrigin('origin',[local.head().hash],'writer-stated')
  expect(historyOrigins('origin',[local.head()])[0]!.originAssurance).toBe('local')
})
it('a durable verified receipt enriches CLI log and incremental session history after reload',async()=>{
  const file=fixture(),source=createChain(skeletonDocument('Remote'),{author:'human',message:'outage edit',originNode:'metal-3'},{docId:'remote'})
  const bytes=source.save(),imported=loadChain(bytes);materializeDocument(file,imported)
  rememberOrigin('remote',[imported.head().hash],'writer-stated')
  expect(readFileSync(file+'.chain')).toEqual(Buffer.from(bytes))
  const io=captureIo();expect(await runChain([file,'log','--json'],io)).toBe(0)
  expect(JSON.parse(io.out[0]!).entries[0]).toMatchObject({originNode:'metal-3',originAssurance:'writer-stated'})
  const sent:WireServiceMessage[]=[],session=createSession({path:file,watch:false,send:m=>sent.push(m)})
  try{
    session.receive(JSON.stringify({t:'hello',protocol:'0.2',client:'history-test',author:'user:history-reader'}))
    session.receive(JSON.stringify({t:'log',id:'log',limit:10}))
    session.receive(JSON.stringify({t:'activity',id:'activity',limit:10}))
    const log=sent.find(m=>m.t==='log') as Extract<WireServiceMessage,{t:'log'}>
    expect(log.entries[0]).toMatchObject({originNode:'metal-3',originAssurance:'writer-stated'})
    const baseline=sent.find(m=>m.t==='activity') as Extract<WireServiceMessage,{t:'activity'}>
    source.apply({author:'human',message:'after outage',originNode:'metal-3'},[{op:'set-token',name:'remote',value:'yes'}])
    materializeDocument(file,loadChain(source.save()))
    rememberOrigin('remote',[source.head().hash],'writer-stated')
    sent.length=0
    session.receive(JSON.stringify({t:'activity',id:'delta',limit:10,since:baseline.frontier}))
    const delta=sent.find(m=>m.t==='activity') as Extract<WireServiceMessage,{t:'activity'}>
    expect(delta.entries.find(e=>e.hash===source.head().hash)).toMatchObject({originNode:'metal-3',originAssurance:'writer-stated'})
  }finally{session.close()}
})

it('backfills retained verified journal receipts without treating source local as authorship',()=>{
  fixture();const chain=createChain(skeletonDocument('Cached'),{author:'human',message:'cached',originNode:'remote'},{docId:'cached'});chain.takeAuthoredChanges()
  initializeActivityJournal()
  recordActivity({file:join(dir,'board.fdn.html'),workspace:'w',product:'p',docId:'cached'},chain,[chain.head().hash],{ownerNodeId:'observer',repo:null,delivery:'baseline',signatureVerified:true,source:'local'})
  flushActivityJournal();closeActivityJournal()
  rmSync(join(dir,'replicas','history-origin'),{recursive:true,force:true})
  expect(historyOrigins('cached',chain.log())[0]!.originAssurance).toBeNull()
  initializeActivityJournal();closeActivityJournal()
  expect(historyOrigins('cached',chain.log())[0]!.originAssurance).toBe('writer-stated')
})
