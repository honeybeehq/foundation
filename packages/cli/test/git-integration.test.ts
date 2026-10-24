import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { loadChain } from 'foundation-engine'
import { projectedText } from '../src/disk.js'

it.each(['merge', 'cherry-pick', 'rebase'])('real CLI edits in separate copies survive git %s and repeated sync stays clean', (operation) => {
 const temp=mkdtempSync(join(tmpdir(),'fdn-real-git-'))
 const source=resolve(dirname(fileURLToPath(import.meta.url)),'../src/main.ts')
 const tsx=resolve('node_modules/tsx/dist/cli.mjs')
 const bin=join(temp,'bin');mkdirSync(bin)
 const quote=(s:string)=>`'${s.replaceAll("'", "'\\''")}'`
 writeFileSync(join(bin,'foundation'),`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(tsx)} ${quote(source)} "$@"\n`);chmodSync(join(bin,'foundation'),0o755)
 const env={...process.env,PATH:`${bin}:${process.env.PATH}`}
 const a=join(temp,'a'),b=join(temp,'b');mkdirSync(a)
 function log(text:string) { console.log(text); if (process.env.S4_TRANSCRIPT) appendFileSync(process.env.S4_TRANSCRIPT,text+'\n') }
 function run(cwd:string,cmd:string,...args:string[]) {let out:string; try { out=execFileSync(cmd,args,{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}) } catch(error) { console.log(String((error as {stdout?:unknown}).stdout),String((error as {stderr?:unknown}).stderr)); throw error }log(`$ ${cmd} ${args.join(' ')}\n${out.trim()}`);return out}
 try {
 run(a,'git','init','-b','main');run(a,'git','config','user.email','test@example.org');run(a,'git','config','user.name','S4')
 run(a,'foundation','new','board');run(a,'foundation','git','setup')
 const attributes=statSync(join(a,'.gitattributes')).mtimeMs;run(a,'foundation','git','setup');expect(statSync(join(a,'.gitattributes')).mtimeMs).toBe(attributes)
 run(a,'git','add','.');run(a,'git','commit','-m','base')
 run(temp,'git','clone',a,b);run(b,'git','config','user.email','test@example.org');run(b,'git','config','user.name','S4');run(b,'foundation','git','setup');run(b,'git','checkout','-b','other')
 for (const [cwd,name,color] of [[a,'ours','red'],[b,'theirs','blue']]) {
 run(cwd!,'foundation','edit','board.fdn.html','--ops',JSON.stringify([{op:'set-token',name,value:color}]))
 run(cwd!,'git','add','.');run(cwd!,'git','commit','-m',name!)
 }
 run(a,'git','fetch',b,'other:refs/heads/other');unlinkSync(join(a,'.git','FETCH_HEAD'));run(a,'git',operation,...(operation === 'merge' ? ['--no-edit','other'] : ['other']))
 const file=join(a,'board.fdn.html'),chain=loadChain(readFileSync(file+'.chain'))
 expect(chain.doc().tokens).toMatchObject({ours:'red',theirs:'blue'})
 expect(readFileSync(file,'utf8')).toBe(projectedText(chain))
 expect(run(a,'git','status','--porcelain')).toBe('')
 const before=['','.chain'].map(s=>statSync(file+s).mtimeMs)
 run(a,'foundation','chain','sync','board.fdn.html',join(temp,'mail'))
 run(a,'foundation','chain','sync','board.fdn.html',join(temp,'mail'))
 expect(run(a,'git','status','--porcelain')).toBe('')
 expect(['','.chain'].map(s=>statSync(file+s).mtimeMs)).toEqual(before)
 log(`PASS git ${operation}: both edits survive; exact regenerated projection; clean Git status after operation and two syncs; mtimes unchanged`)
 } finally {rmSync(temp,{recursive:true,force:true})}
},30000)
