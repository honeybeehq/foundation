/** Actual CLI cold-read/transition drill; local synthetic facts, no network. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createChain } from 'foundation-engine'
import { skeletonDocument } from '../src/commands/new.js'
import { initializeActivityJournal, closeActivityJournal, recordActivity, flushActivityJournal } from '../src/sync/local-model.js'
mkdirSync('.audit/S7h',{recursive:true})
const root=mkdtempSync(resolve('.audit/S7h/run-')),target=join(root,'target'),staging=join(root,'staging'),previous=process.env.FOUNDATION_REPLICA_STORE
const child=spawn(process.execPath,['--import','tsx','packages/cli/src/main.ts','sync','activity','--workspace','w','--follow','--json'],{env:{...process.env,FOUNDATION_REPLICA_STORE:target},stdio:['ignore','pipe','pipe']})
const rows:any[]=[];let buffer='',errors=''
child.stdout.on('data',chunk=>{buffer+=chunk.toString();let end:number;while((end=buffer.indexOf('\n'))>=0){rows.push(JSON.parse(buffer.slice(0,end)));buffer=buffer.slice(end+1)}})
child.stderr.on('data',chunk=>errors+=chunk.toString())
async function until(test:()=>boolean,label:string){const end=Date.now()+5000;while(!test()){assert(Date.now()<end,label+': '+errors);await new Promise(r=>setTimeout(r,10))}}
try{
  await until(()=>rows.some(r=>r.type==='ready'),'cold ready')
  assert.equal(existsSync(target),false);assert.equal(errors,'')
  console.log('PASS actual CLI cold follow: empty ready, no state files or errors')
  process.env.FOUNDATION_REPLICA_STORE=staging;initializeActivityJournal()
  const chain=createChain(skeletonDocument('Cold reader'),{author:'proof',message:'before catch-up'},{docId:'cold'})
  const design={file:join(root,'board.fdn.html'),workspace:'w',product:'p',docId:'cold'}
  recordActivity(design,chain,[chain.head().hash],{ownerNodeId:'observer',repo:null,delivery:'live'})
  flushActivityJournal();closeActivityJournal();renameSync(staging,target)
  await until(()=>rows.filter(r=>r.type==='ready').length===2&&rows.some(r=>r.entry),'journal catch-up')
  assert.equal(rows.find(r=>r.entry).delivery,'baseline')
  assert.notEqual(rows.filter(r=>r.type==='ready')[0].cursor,rows.filter(r=>r.type==='ready')[1].cursor)
  console.log('PASS actual CLI journal transition: caught-up baseline and new ready cursor')
  process.env.FOUNDATION_REPLICA_STORE=target;initializeActivityJournal()
  chain.apply({author:'proof',message:'after catch-up'},[{op:'set-token',name:'later',value:'yes'}])
  const hash=chain.head().hash;recordActivity(design,chain,[hash],{ownerNodeId:'observer',repo:null,delivery:'live'});flushActivityJournal()
  await until(()=>rows.some(r=>r.entry?.hash===hash),'fresh live fact')
  assert.equal(rows.find(r=>r.entry?.hash===hash).delivery,'live')
  console.log('PASS actual CLI subsequent fact: live only after catch-up')
  const exit=once(child,'exit');child.kill('SIGTERM');assert.deepEqual(await exit,[0,null]);assert.equal(errors,'')
  console.log('PASS actual CLI SIGTERM: exit0, no activity error')
}finally{
  closeActivityJournal()
  if(previous===undefined)delete process.env.FOUNDATION_REPLICA_STORE;else process.env.FOUNDATION_REPLICA_STORE=previous
  if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'exit')}
}
