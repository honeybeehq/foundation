import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { loadChain } from 'foundation-engine'
import { captureIo } from '../src/io.js'
import { runNew } from '../src/commands/new.js'
import { runGitMergeDriver } from '../src/commands/git-merge-driver.js'
import { projectedText } from '../src/disk.js'

it('merges both binary histories and rejects HTML without repository context', async () => {
 const dir=mkdtempSync(join(tmpdir(),'fdn-git-'))
 try {
 await runNew([join(dir,'base')],captureIo())
 const base=readFileSync(join(dir,'base.fdn.html.chain'))
 const a=loadChain(base,{actor:'a'}), b=loadChain(base,{actor:'b'})
 a.apply({author:'a',message:'a'},[{op:'set-token',name:'a',value:'red'}])
 b.apply({author:'b',message:'b'},[{op:'set-token',name:'b',value:'blue'}])
 const ours=join(dir,'A'),theirs=join(dir,'B')
 writeFileSync(ours,projectedText(a));writeFileSync(theirs,projectedText(b))
 expect(await runGitMergeDriver(['unused',ours,theirs],captureIo())).toBe(1)
 writeFileSync(ours,a.save());writeFileSync(theirs,b.save())
 expect(await runGitMergeDriver(['unused',ours,theirs,'nested/renamed.fdn.html.chain'],captureIo())).toBe(0)
 expect(loadChain(readFileSync(ours)).doc().tokens).toMatchObject({a:'red',b:'blue'})
 } finally {rmSync(dir,{recursive:true,force:true})}
})

it('returns failure and preserves ours for invalid chains, old HTML, and uncommitted HTML edits',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fdn-bad-git-'))
 try {
 const a=join(dir,'A'),b=join(dir,'B')
 for(const content of ['bad chain','<fdn-doc></fdn-doc>']){
 writeFileSync(a,content);writeFileSync(b,content)
 expect(await runGitMergeDriver(['unused',a,b],captureIo())).toBe(1)
 expect(readFileSync(a,'utf8')).toBe(content)
 }
 await runNew([join(dir,'base')],captureIo())
 const html=readFileSync(join(dir,'base.fdn.html'),'utf8')
 writeFileSync(a,html.replace('Hello, Foundation','Uncommitted'));writeFileSync(b,html)
 expect(await runGitMergeDriver(['unused',a,b],captureIo())).toBe(1)
 expect(await runGitMergeDriver([],captureIo())).toBe(2)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
