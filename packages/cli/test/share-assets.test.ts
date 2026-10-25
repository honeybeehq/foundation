import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { createChain } from 'foundation-engine'
import { skeletonDocument } from '../src/commands/new.js'
import { AssetSharing, assetRef, assetReferences, sniffAsset, MAX_ASSET } from '../src/share/assets.js'
vi.mock('../src/share/vault.js',()=>({sessionFor:()=>({permission:'read'})}))
const store=new Map<string,{seq:string;payload_hex:string}[]>()
vi.mock('../src/share/transport.js',()=>({createBridge:(config:any)=>({hello:async()=>{},finish:async()=>{},close:()=>{},request:async(op:string,f:any)=>{
 const key=config.shareLog,rows=store.get(key)??[]
 if(op==='append'){if(!rows.some(r=>r.payload_hex===f.payload_hex))rows.push({seq:String(rows.length+1),payload_hex:f.payload_hex});store.set(key,rows);return{log:f.log,cursor:String(rows.length+1),first:String(rows.length),last:String(rows.length),durable:true}}
 if(op==='head')return{log:f.log,cursor:String(rows.length+1)}
 const index=Number(f.cursor)-1;return{log:f.log,events:rows.slice(index,index+1),next_cursor:String(index+2)}
}})}))
let root:string
const config:any={binary:'',args:[],share:{space:'test'}}
afterEach(async()=>{store.clear();vi.unstubAllEnvs();if(root)await rm(root,{recursive:true,force:true})})
async function fixture(bytes=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(300000,71)])){
 root=await mkdtemp(join(tmpdir(),'share-assets-'));vi.stubEnv('FOUNDATION_REPLICA_STORE',join(root,'replicas'));const a=join(root,'a','board.fdn.html'),b=join(root,'b','board.fdn.html');await mkdir(join(root,'a','.foundation','assets'),{recursive:true});await mkdir(join(root,'b'))
 const hash=createHash('sha256').update(bytes).digest('hex'),path=`.foundation/assets/${hash}.png`
 await writeFile(join(root,'a',path),bytes)
 const doc=skeletonDocument('Image');doc.body[0]!.attrs.src=path
 return{a,b,path,bytes,chain:createChain(doc,{author:'seed',message:'asset'},{docId:'asset'})}
}
it('finds only confined local image references including CSS, and rejects traversal',()=>{
 const path='.foundation/assets/'+'a'.repeat(64)+'.png'
 expect(assetReferences({src:path,background:`url("${path}")`,source:'https://example.com/'+path})).toHaveLength(1)
 expect(()=>assetRef('.foundation/assets/../../secret.png')).toThrow()
 expect(sniffAsset(Buffer.from('GIF89a'))).toBe('gif')
})
it('streams a multi-chunk asset, deduplicates retries and installs exact immutable bytes',async()=>{
 const f=await fixture(),publisher=new AssetSharing(config,f.a,root)
 await publisher.publish(f.chain);const count=store.size;expect(count).toBe(3)
 await new AssetSharing(config,f.a,root).publish(f.chain);expect(store.size).toBe(count)
 await new AssetSharing(config,f.b,root).receive(f.chain)
 expect(await readFile(join(root,'b',f.path))).toEqual(f.bytes)
 await writeFile(join(root,'b',f.path),'corrupt local immutable file')
 await expect(new AssetSharing(config,f.b,root).receive(f.chain)).rejects.toThrow()
})
it('refuses missing, reordered and altered chunks without exposing a partial asset',async()=>{
 const f=await fixture();await new AssetSharing(config,f.a,root).publish(f.chain)
 const rows=[...store.values()][1]!,original=rows.map(r=>({...r}));rows.splice(0,1)
 await expect(new AssetSharing(config,f.b,root).receive(f.chain)).rejects.toThrow('chunk missing')
 rows.splice(0,rows.length,...original);const bytes=Buffer.from(rows[0]!.payload_hex,'hex');bytes[bytes.length-1]=bytes[bytes.length-1]!^1;rows[0]!.payload_hex=bytes.toString('hex')
 await expect(new AssetSharing(config,f.b,root).receive(f.chain)).rejects.toThrow('hash mismatch')
 expect(await readdir(join(root,'b','.foundation','assets'))).toEqual([])
})
it('refuses symlink escape and oversized files before uploading anything',async()=>{
 const f=await fixture();await rm(join(root,'a','.foundation','assets'),{recursive:true});await symlink(join(root,'b'),join(root,'a','.foundation','assets'))
 await expect(new AssetSharing(config,f.a,root).publish(f.chain)).rejects.toThrow('symlink')
 await rm(join(root,'a','.foundation','assets'));await mkdir(join(root,'a','.foundation','assets'));await writeFile(join(root,'a',f.path),Buffer.alloc(MAX_ASSET+1))
 await expect(new AssetSharing(config,f.a,root).publish(f.chain)).rejects.toThrow('20MiB')
 expect(store.size).toBe(0)
})
it('retains unreferenced images and fetches a historical image before an undo is republished',async()=>{
 const f=await fixture(),old=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(4096,13)]),hash=createHash('sha256').update(old).digest('hex'),path=`.foundation/assets/${hash}.png`
 await writeFile(join(root,'a',path),old)
 await new AssetSharing(config,f.a,root).publish(f.chain)
 const replica=new AssetSharing(config,f.b,root);await replica.receive(f.chain)
 f.chain.apply({author:'member',message:'undo old image'},[{op:'set-attr',id:'n1',key:'src',value:path}])
 await replica.publish(f.chain)
 expect(await readFile(join(root,'b',path))).toEqual(old)
})
it('cleans dead-owner partials but preserves active-owner temporary files',async()=>{
 const f=await fixture();await new AssetSharing(config,f.a,root).publish(f.chain)
 const dir=join(root,'b','.foundation/assets');await mkdir(dir,{recursive:true})
 await writeFile(join(dir,'.asset-2147483647-aaa.tmp'),'partial');const live=`.asset-${process.pid}-bbb.tmp`;await writeFile(join(dir,live),'live')
 await new AssetSharing(config,f.b,root).receive(f.chain)
 expect(await readdir(dir)).toEqual(expect.arrayContaining([live]))
 expect(await readdir(dir)).not.toContain('.asset-2147483647-aaa.tmp')
})
it('ignores prose and malformed names instead of stopping publication',()=>{
 expect(assetReferences({text:'see .foundation/assets/logo.png',other:'Put images in .foundation/assets/<hash>.png',src:'.foundation/assets/logo.png'})).toEqual([])
 expect(sniffAsset(Buffer.from('<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('svg')
 expect(()=>sniffAsset(Buffer.from('<!DOCTYPE svg [<!ENTITY x "x">]><svg/>'))).toThrow('entity')
})
it('isolates missing assets and remote chunks in visible status without blocking foreground changes',async()=>{
 const f=await fixture();await rm(join(root,'a',f.path))
 const sharing=new AssetSharing(config,f.a,root)
 await expect(sharing.publish(f.chain,false)).resolves.toBeUndefined()
 const {readAssetStatus}=await import('../src/share/assets.js')
 expect(readAssetStatus(f.a)).toEqual(expect.arrayContaining([expect.objectContaining({path:f.path,state:'error'})]))
 await expect(new AssetSharing(config,f.b,root).receive(f.chain,false)).resolves.toBeUndefined()
 expect(readAssetStatus(f.b)).toEqual(expect.arrayContaining([expect.objectContaining({path:f.path,state:'error'})]))
})
it('uses a later repaired chunk instead of being pinned to a bad first event',async()=>{
 const f=await fixture();await new AssetSharing(config,f.a,root).publish(f.chain)
 const rows=[...store.values()][0]!,good={...rows[0]!}
 rows[0]!.payload_hex=Buffer.from('bad first event').toString('hex');rows.push({...good,seq:'2'})
 await new AssetSharing(config,f.b,root).receive(f.chain)
 expect(await readFile(join(root,'b',f.path))).toEqual(f.bytes)
})

it('a read-only member retries availability without attempting uploads',async()=>{
 const f=await fixture();await mkdir(join(root,'b','.foundation/assets'),{recursive:true});await writeFile(join(root,'b',f.path),f.bytes)
 const reader=new AssetSharing(config,f.b,root),publish=vi.spyOn(reader,'publish')
 reader.retry(f.chain)
 await reader.receive(f.chain)
 expect(publish).not.toHaveBeenCalled();expect(store.size).toBe(0)
 const {readAssetStatus}=await import('../src/share/assets.js');expect(readAssetStatus(f.b)).toContainEqual({path:f.path,state:'ready',reason:null})
})
