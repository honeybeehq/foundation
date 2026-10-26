/** Real CLI/session + daemon/Comb registration drill. No GitHub or network claims. */
import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createChain, loadChain } from 'foundation-engine'
import { skeletonDocument } from '../src/commands/new.js'
import { materializeDocument } from '../src/disk.js'
import { acquireDocumentLock } from '../src/document-lock.js'

const binary=process.argv[2];assert(binary,'pass absolute comb-bridge path')
mkdirSync('.audit/H2e',{recursive:true})
const root=mkdtempSync(resolve('.audit/H2e/run-')),store=join(root,'replicas'),file=join(root,'board.fdn.html')
const env={...process.env,FOUNDATION_REPLICA_STORE:store,FOUNDATION_SYNC_AUTO_OPEN:'1',FOUNDATION_WORKSPACE:'w',FOUNDATION_PRODUCT:'p'}
const chain=createChain(skeletonDocument('Registration'),{author:'proof',message:'init'},{docId:'registration'})
materializeDocument(file,chain)
const comb=join(root,'comb');mkdirSync(comb)
writeFileSync(join(comb,'config.toml'),`tenant = "registration-proof"\ndigest_key = "${randomBytes(32).toString('hex')}"\n[backend]\nkind = "local"\nroot = "${join(root,'objects')}"\n`)
const config=join(root,'comb.json');writeFileSync(config,JSON.stringify({binary:resolve(binary),args:['--dir',comb,'--lease','3']}))
const children:ChildProcessWithoutNullStreams[]=[]
function cli(args:string[]){const child=spawn(process.execPath,['--import','tsx','packages/cli/src/main.ts',...args],{env,stdio:'pipe'});children.push(child);return child}
async function until(test:()=>boolean,label:string){const deadline=Date.now()+15000;while(!test()){assert(Date.now()<deadline,label);await new Promise(r=>setTimeout(r,20))}}
async function status(){const child=cli(['sync','status','--json']);let out='';child.stdout.on('data',b=>out+=b);const [code]=await once(child,'exit');assert.equal(code,0);return JSON.parse(out)[0]}
let release=()=>{}
try{
  const session=cli(['session',file]);let output='',errors='';session.stdout.on('data',b=>output+=b);session.stderr.on('data',b=>errors+=b)
  session.stdin.write(JSON.stringify({t:'hello',protocol:'0.2',client:'registration-proof',author:'user:proof'})+'\n')
  await until(()=>output.includes('"t":"welcome"'),'session welcome')
  assert(!errors.includes('document is busy'),errors)
  assert.equal((await status()).status,'sharing pending')
  console.log('PASS real session hello: registered without nested-lock warning; status=sharing pending')
  release=acquireDocumentLock(file)
  const daemon=cli(['sync','serve','--comb-config',config]);let daemonErrors='';daemon.stderr.on('data',b=>daemonErrors+=b)
  await until(()=>daemonErrors.includes('startup: document is busy'),'daemon observes actual held document lock')
  assert.match((await status()).lastError,/startup: document is busy/)
  release();release=()=>{}
  await until(()=>loadChain(readFileSync(file+'.chain')).storageFormat()===2,'daemon upgrades after release')
  const sharedDeadline=Date.now()+15000
  for(;;){if((await status()).status==='shared')break;assert(Date.now()<sharedDeadline,'daemon publication');await new Promise(r=>setTimeout(r,40))}
  assert(!errors.includes('Retry the edit'),errors)
  console.log('PASS real daemon: busy startup retried without lock deletion; format2 and shared after release')
  session.stdin.end();assert.equal((await once(session,'exit'))[0],0)
  daemon.kill('SIGTERM');assert.equal((await once(daemon,'exit'))[0],0)
  console.log('PASS session and daemon exit0; actual Comb durable publication complete')
  const close=cli(['sync','close',file]);assert.equal((await once(close,'exit'))[0],0)
  const edit=cli(['edit',file,'--ops',JSON.stringify([{op:'set-token',name:'proof',value:'saved'}])]);let editErrors='';edit.stderr.on('data',b=>editErrors+=b)
  assert.equal((await once(edit,'exit'))[0],0)
  assert(!editErrors.includes('document is busy'),editErrors)
  assert.equal((await status()).docId,'registration')
  assert.equal(loadChain(readFileSync(file+'.chain')).doc().tokens.proof,'saved')
  console.log('PASS real CLI edit: saved and auto-registered after closing registration')
}finally{
  release()
  for(const child of children)if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'exit')}
}
