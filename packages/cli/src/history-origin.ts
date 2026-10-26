/** Local observer receipts, never part of envelopes or chain identity. */
import { createHash } from 'node:crypto'
import { mkdirSync, openSync, closeSync, writeFileSync, fsyncSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { EnvelopeRecord, FdnChain } from 'foundation-engine'
import { replicaRoot } from './sync-store.js'

export type OriginAssurance = 'writer-stated' | 'local' | null
const cache=new Map<string,{stamp:string;values:Map<string,Exclude<OriginAssurance,null>>}>()
function root(docId:string):string{return join(replicaRoot(),'history-origin',createHash('sha256').update(docId).digest('hex'))}
function values(path:string):Map<string,Exclude<OriginAssurance,null>>{
  try{
    const info=statSync(path),stamp=`${info.ino}:${info.size}:${info.mtimeMs}`,old=cache.get(path)
    if(old?.stamp===stamp)return old.values
    const result=new Map<string,Exclude<OriginAssurance,null>>()
    for(const line of readFileSync(path,'utf8').split('\n')){
      if(!/^[LV][a-f0-9]{64}$/.test(line))continue
      const hash=line.slice(1)
      if(result.get(hash)!=='local')result.set(hash,line[0]==='L'?'local':'writer-stated')
    }
    // Bounded cache; the append-only receipts survive journal payload eviction.
    if(info.size<=1048576){cache.delete(path);cache.set(path,{stamp,values:result});while(cache.size>16)cache.delete(cache.keys().next().value!)}
    return result
  }catch{return new Map()}
}
export function rememberOrigin(docId:string|null|undefined,hashes:readonly string[],assurance:Exclude<OriginAssurance,null>):void{
  if(!docId||!hashes.length)return
  try{
    const dir=root(docId),groups=new Map<string,string[]>()
    for(const hash of new Set(hashes)){
      if(!/^[a-f0-9]{64}$/.test(hash))continue
      const path=join(dir,hash.slice(0,2)+'.txt'),group=groups.get(path)??[]
      group.push(hash);groups.set(path,group)
    }
    mkdirSync(dir,{recursive:true,mode:0o700})
    let wrote=false
    for(const [path,group]of groups){
      const known=values(path),lines=group.filter(hash=>known.get(hash)!=='local'&&known.get(hash)!==assurance).map(hash=>(assurance==='local'?'L':'V')+hash+'\n')
      if(!lines.length)continue
      const fd=openSync(path,'a',0o600);try{writeFileSync(fd,lines.join(''));fsyncSync(fd)}finally{closeSync(fd)}cache.delete(path);wrote=true
    }
    if(wrote){const fd=openSync(dir,'r');try{fsyncSync(fd)}finally{closeSync(fd)}}
  }catch{/* Missing observer metadata must never fail an edit or import. */}
}
export function rememberAuthored(chain:FdnChain):void{
  rememberOrigin(chain.docId(),chain.takeAuthoredChanges().map(e=>e.hash),'local')
}
export function historyOrigins<T extends EnvelopeRecord>(docId:string|null|undefined,entries:readonly T[]):Array<T&{originNode:string|null;originAssurance:OriginAssurance}>{
  return entries.map(entry=>({...entry,originNode:entry.originNode??null,originAssurance:docId&&entry.originNode?values(join(root(docId),entry.hash.slice(0,2)+'.txt')).get(entry.hash)??null:null}))
}
