import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { loadChain } from 'foundation-engine'
import { updateDocument } from '../src/disk.js'

it.each(['synced', 'local-chain', 'local-text', 'blocked', 'command-fails', 'killed-update', 'head-moved'])('preserves %s work through a live-synced Git update', mode => {
 const temp=mkdtempSync(join(tmpdir(),'fdn-git-update-')), a=join(temp,'a'),b=join(temp,'b')
 mkdirSync(a)
 const main=resolve('packages/cli/src/main.ts'),tsx=resolve('node_modules/tsx/dist/cli.mjs')
 const env={...process.env,FOUNDATION_CACHE_DIR:join(temp,'cache'),FOUNDATION_REPLICA_ROOT:join(temp,'replicas')}
 const log=(text:string)=>{if(process.env.S4B_TRANSCRIPT)appendFileSync(process.env.S4B_TRANSCRIPT,text+'\n')}
 function run(cwd:string,program:string,args:string[],ok=true){const r=spawnSync(program,args,{cwd,env,encoding:'utf8'});log(`$ ${program==='git'?'git':'foundation'} ${args.filter(x=>x!==tsx&&x!==main).join(' ')}\n${r.stdout}${r.stderr}exit=${r.status}`);if(ok)expect(r.status,`${r.stdout}\n${r.stderr}`).toBe(0);return r}
 const git=(cwd:string,...args:string[])=>run(cwd,'git',args).stdout.trim()
 const cli=(cwd:string,...args:string[])=>run(cwd,process.execPath,[tsx,main,...args])
 try {
 git(a,'init','-b','main');git(a,'config','user.email','test@example.org');git(a,'config','user.name','S4b')
 cli(a,'new','board');cli(a,'git','setup');writeFileSync(join(a,'notes.txt'),'base\n');git(a,'add','.');git(a,'commit','-m','base')
 git(temp,'clone',a,b);cli(b,'git','setup')
 cli(a,'edit','board.fdn.html','--ops',JSON.stringify([{op:'set-token',name:'from-a',value:'red'}]))
 git(a,'add','.');git(a,'commit','-m','A edit')
 // Same bytes delivered to B before its branch knows about A's commit.
 for(const suffix of ['', '.chain'])cpSync(join(a,'board.fdn.html'+suffix),join(b,'board.fdn.html'+suffix))
 if(['local-chain','killed-update','head-moved'].includes(mode))cli(b,'edit','board.fdn.html','--ops',JSON.stringify([{op:'set-token',name:'local-b',value:'blue'}]))
 if(['local-text','killed-update','head-moved'].includes(mode))writeFileSync(join(b,'board.fdn.html'),readFileSync(join(b,'board.fdn.html'),'utf8').replace('Hello, Foundation','Local uncommitted text'))
 if(mode==='blocked')writeFileSync(join(b,'notes.txt'),'local non-design edit\n')
 const original=readFileSync(join(b,'board.fdn.html')),originalChain=readFileSync(join(b,'board.fdn.html.chain'))
 expect(run(b,'git',['pull','--ff-only'],false).status).not.toBe(0)
 if(mode==='killed-update' || mode==='head-moved') {
   git(b,'fetch');const target=git(b,'rev-parse','origin/main')
   const script=mode==='killed-update' ? 'process.kill(process.ppid,"SIGKILL")' : `require('node:child_process').execFileSync('git',['merge','--ff-only',${JSON.stringify(target)}]);process.exit(7)`
   expect(run(b,process.execPath,[tsx,main,'git','prepare-update',target,'--',process.execPath,'-e',script],false).status).not.toBe(0)
   const journal=join(b,'.git','foundation-updates',readdirSync(join(b,'.git','foundation-updates'))[0]!)
   cli(b,'git','recover-update',journal)
   const recovered=readFileSync(join(b,'board.fdn.html')),recoveredChain=readFileSync(join(b,'board.fdn.html.chain'))
   expect(loadChain(recoveredChain).doc().tokens['local-b']).toBe('blue')
   expect(recovered.toString()).toContain('Local uncommitted text')
   cli(b,'git','recover-update',journal)
   expect(readFileSync(join(b,'board.fdn.html'))).toEqual(recovered)
   expect(readFileSync(join(b,'board.fdn.html.chain'))).toEqual(recoveredChain)
   log(`PASS ${mode}: local chain and text edits recovered, dead writer lock reaped, repeated recovery byte-identical`);return
 }
 if(mode==='command-fails') {
   git(b,'fetch');const target=git(b,'rev-parse','origin/main')
   expect(run(b,process.execPath,[tsx,main,'git','prepare-update',target,'--',process.execPath,'-e','process.exit(7)'],false).status).not.toBe(0)
   expect(readFileSync(join(b,'board.fdn.html'))).toEqual(original)
   expect(readFileSync(join(b,'board.fdn.html.chain'))).toEqual(originalChain)
   log('PASS failing update restores exact original design and retains backup');return
 }
 if(mode==='blocked') {
   expect(run(b,process.execPath,[tsx,main,'git','pull'],false).stderr).toContain('non-design')
   expect(readFileSync(join(b,'board.fdn.html'))).toEqual(original)
   expect(readFileSync(join(b,'board.fdn.html.chain'))).toEqual(originalChain)
   expect(readFileSync(join(b,'notes.txt'),'utf8')).toBe('local non-design edit\n')
   log('PASS non-design edit refuses before resetting designs');return
 }
 cli(b,'git','pull')
 expect(git(b,'rev-parse','HEAD')).toBe(git(a,'rev-parse','HEAD'))
 const file=join(b,'board.fdn.html'),chain=loadChain(readFileSync(file+'.chain'))
 expect(chain.doc().tokens['from-a']).toBe('red')
 if(['local-chain','killed-update','head-moved'].includes(mode))expect(chain.doc().tokens['local-b']).toBe('blue')
 if(mode==='local-text'){expect(readFileSync(file,'utf8')).toContain('Local uncommitted text');expect(chain.log().some(change=>change.message==='preserve local edits before Git update')).toBe(true)}
 if(mode==='synced')expect(git(b,'status','--porcelain')).toBe('')
 else expect(git(b,'status','--porcelain')).toContain('board.fdn.html')
 const times=['','.chain'].map(s=>statSync(file+s).mtimeMs)
 // Actual receive/save path used by serveSync, including duplicate delivery.
 updateDocument(file,latest=>latest.merge(chain),true)
 expect(['','.chain'].map(s=>statSync(file+s).mtimeMs)).toEqual(times)
 expect(git(a,'status','--porcelain')).toBe('')
 log(`PASS ${mode}: pull advances HEAD, local edits survive, duplicate daemon save does not rewrite; A clean${mode==='synced'?', B clean':', B local changes remain uncommitted'}`)
 }finally{rmSync(temp,{recursive:true,force:true})}
},30000)
