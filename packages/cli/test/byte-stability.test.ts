import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { loadChain, mergeChains, exportBlobs, importBlobs } from 'foundation-engine'
import { runNew } from '../src/commands/new.js'
import { captureIo } from '../src/io.js'
import { persistDocument } from '../src/disk.js'

it('saves identical bytes after opposite import, exchange and merge orders without rewriting unchanged files', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'fdn-bytes-'))
 try {
 await runNew([join(dir,'base')], captureIo())
 const base = readFileSync(join(dir,'base.fdn.html.chain'))
 const a = loadChain(base,{actor:'a'}), b = loadChain(base,{actor:'b'})
 a.apply({author:'a',message:'a'},[{op:'set-token',name:'a',value:'red'}])
 b.apply({author:'b',message:'b'},[{op:'set-token',name:'b',value:'blue'}])
 const left = loadChain(base), right = loadChain(base)
 for (const c of [...a.changes(),...b.changes()]) left.importUpdate(c.bytes)
 for (const c of [...b.changes(),...a.changes()]) right.importUpdate(c.bytes)
 await exportBlobs(a,join(dir,'exchange')); await exportBlobs(b,join(dir,'exchange'))
 const exchanged = loadChain(base); await importBlobs(exchanged,join(dir,'exchange'))
 const chains = [left,right,exchanged,loadChain(mergeChains(a.save(),b.save()).merged),loadChain(mergeChains(b.save(),a.save()).merged)]
 for (const [i,c] of chains.entries()) persistDocument(join(dir,`${i}.fdn.html`),c)
 for (let i=1;i<chains.length;i++) for(const suffix of ['', '.chain']) expect(readFileSync(join(dir,`${i}.fdn.html${suffix}`))).toEqual(readFileSync(join(dir,`0.fdn.html${suffix}`)))
 console.log('same frontier: opposite imports, exchange, both merge directions: chain and HTML bytes identical')
 const file=join(dir,'0.fdn.html'); const before=['','.chain','.chain.projection'].map(s=>statSync(file+s).mtimeMs)
 persistDocument(file,loadChain(readFileSync(file+'.chain')))
 expect(['','.chain','.chain.projection'].map(s=>statSync(file+s).mtimeMs)).toEqual(before)
 } finally { rmSync(dir,{recursive:true,force:true}) }
})
