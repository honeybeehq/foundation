import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, readSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChainLogEntry, FdnChain } from 'foundation-engine'
import type { LiveDesign } from '../sync-store.js'
import { modelRoot, persistModel, type ImportedFact } from './local-model.js'

const RETAIN = 10000, SEGMENT = 256, BUCKET_LIMIT = 650000
interface Segment { first: number; last: number; bytes: number }
interface Index { version: 2; id: string; next: number; dedupThrough: number; segments: Segment[] }
interface Options { ownerNodeId: string; repo: string | null; delivery: 'baseline'|'live'; signatureVerified?: boolean; signatures?: ReadonlySet<string>; source?: 'local'|'import'; importedHashes?: ReadonlySet<string> }
interface Task { key: string; design: LiveDesign; chain: FdnChain; hash: string; options: Options; verified: boolean; source: 'local'|'import'; observedAt: number }
interface Writer { root: string; index: Index; seen: Map<string,true>; pending: Map<string,Task>; timer?: NodeJS.Timeout; onError: (message:string)=>void }
let writer: Writer | undefined
const hashOf=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const factKey=(event:Pick<ImportedFact,'document'|'entry'>):string=>hashOf([JSON.stringify([event.document.workspaceId,event.document.productId,event.document.docId]),event.entry.hash])
const taskKey=(design:LiveDesign,hash:string):string=>hashOf([JSON.stringify([design.workspace,design.product,design.docId]),hash])
const indexPath=(root:string):string=>join(root,'activity-index.json')
const segmentDir=(root:string,id:string):string=>join(root,'activity-events',id)
const segmentPath=(root:string,id:string,first:number):string=>join(segmentDir(root,id),`${first}.ndjson`)
const seenDir=(root:string,id:string):string=>join(root,'activity-seen',id)
const seenPath=(root:string,id:string,key:string):string=>join(seenDir(root,id),key.slice(0,2)+'.txt')
const cursor=(index:Index,seq:number):string=>`sync-activity1:${index.id}:${seq}`
function syncDirectory(path:string):void { const fd=openSync(path,'r');try{fsyncSync(fd)}finally{closeSync(fd)} }
function remember(state:Writer,key:string):void { state.seen.delete(key);state.seen.set(key,true);if(state.seen.size>RETAIN)state.seen.delete(state.seen.keys().next().value!) }
function readIndex(root:string):Index {
  if(statSync(indexPath(root)).size>2097152)throw new Error('invalid activity index; establish a new baseline')
  const value=JSON.parse(readFileSync(indexPath(root),'utf8')) as Index
  if(value.version!==2||typeof value.id!=='string'||!/^[A-Za-z0-9-]{1,64}$/.test(value.id)||!Number.isSafeInteger(value.next)||value.next<1||!Number.isSafeInteger(value.dedupThrough)||value.dedupThrough<0||value.dedupThrough>=value.next||!Array.isArray(value.segments)||value.segments.length>RETAIN)throw new Error('invalid activity index; establish a new baseline')
  let previous:number|undefined,count=0
  for(const segment of value.segments){
    if(!Number.isSafeInteger(segment.first)||!Number.isSafeInteger(segment.last)||segment.first<1||segment.last<segment.first||segment.last-segment.first>=SEGMENT||!Number.isSafeInteger(segment.bytes)||segment.bytes<1||(previous!==undefined&&segment.first!==previous+1))throw new Error('invalid activity segments')
    count+=segment.last-segment.first+1;previous=segment.last
  }
  if(count>RETAIN||(previous!==undefined&&previous!==value.next-1))throw new Error('invalid activity range')
  return value
}
function parseLines(text:string,index:Index,first:number):ImportedFact[] {
  if(!text.endsWith('\n'))throw new Error('incomplete committed activity segment')
  return text.slice(0,-1).split('\n').filter(Boolean).map((line,n)=>{
    const row=JSON.parse(line) as ImportedFact
    if(row.version!==1||row.cursor!==cursor(index,first+n)||!row.document||typeof row.entry?.hash!=='string')throw new Error('invalid activity segment row')
    return row
  })
}
function readRange(path:string,start:number,end:number):string {
  const fd=openSync(path,'r'),chunks:Buffer[]=[]
  try{if(statSync(path).size<end)throw new Error('missing committed activity bytes');let offset=start
    while(offset<end){const chunk=Buffer.alloc(Math.min(65536,end-offset));const size=readSync(fd,chunk,0,chunk.length,offset);if(!size)throw new Error('short activity read');chunks.push(chunk.subarray(0,size));offset+=size}
  }finally{closeSync(fd)}
  return Buffer.concat(chunks).toString('utf8')
}
function allRows(root:string,index:Index):ImportedFact[]{return index.segments.flatMap(s=>parseLines(readRange(segmentPath(root,index.id,s.first),0,s.bytes),index,s.first))}
/** The persistent hash index is append-only and independent of payload retention.
 * Only a bounded 10k recent-key cache lives in memory. Older lookups read one
 * small hash shard (streaming if large), never full fact bodies. */
function hasSeen(state:Writer,key:string):boolean {
  if(state.seen.has(key))return true
  const path=seenPath(state.root,state.index.id,key)
  try{
    const info=statSync(path)
    if(info.size<=BUCKET_LIMIT){if(readFileSync(path,'utf8').split('\n').includes(key)){remember(state,key);return true}return false}
    const fd=openSync(path,'r'),chunk=Buffer.alloc(65536);let tail=''
    try{for(;;){const count=readSync(fd,chunk,0,chunk.length,null);if(!count)break;const value=tail+chunk.subarray(0,count).toString('ascii');const lines=value.split('\n');tail=lines.pop()!;if(lines.includes(key)){remember(state,key);return true}}}finally{closeSync(fd)}
    return false
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error}
}
function appendSeen(state:Writer,keys:readonly string[]):void {
  const groups=new Map<string,string[]>()
  for(const key of keys){const path=seenPath(state.root,state.index.id,key),group=groups.get(path)??[];group.push(key);groups.set(path,group)}
  mkdirSync(seenDir(state.root,state.index.id),{recursive:true,mode:0o700})
  for(const [path,group] of groups){
    const fd=openSync(path,'a+',0o600)
    try{
      // Each fixed-width record is 64 hex bytes plus newline. Drop only an
      // interrupted, uncommitted trailing record before appending after a crash.
      const length=statSync(path).size;ftruncateSync(fd,length-length%65)
      writeFileSync(fd,group.join('\n')+'\n');fsyncSync(fd)
    }finally{closeSync(fd)}
  }
  syncDirectory(seenDir(state.root,state.index.id))
}
function appendRows(state:Writer,rows:ImportedFact[]):void {
  const index=state.index,dir=segmentDir(state.root,index.id)
  mkdirSync(dir,{recursive:true,mode:0o700})
  let remaining=rows
  while(remaining.length){
    let tail=index.segments.at(-1)
    if(!tail||tail.last-tail.first+1>=SEGMENT){const first=Number(remaining[0]!.cursor.split(':').at(-1));tail={first,last:first-1,bytes:0};index.segments.push(tail)}
    const count=Math.min(SEGMENT-(tail.last-tail.first+1),remaining.length),part=remaining.slice(0,count),bytes=Buffer.from(part.map(r=>JSON.stringify(r)).join('\n')+'\n')
    const fd=openSync(segmentPath(state.root,index.id,tail.first),'a+',0o600)
    try{if(statSync(segmentPath(state.root,index.id,tail.first)).size<tail.bytes)throw new Error('missing committed activity segment');ftruncateSync(fd,tail.bytes);writeFileSync(fd,bytes);fsyncSync(fd)}finally{closeSync(fd)}
    tail.bytes+=bytes.length;tail.last+=count;remaining=remaining.slice(count)
  }
  syncDirectory(dir)
}
function trimIndex(index:Index):Segment[]{const removed:Segment[]=[];let count=index.segments.reduce((n,s)=>n+s.last-s.first+1,0)
  while(count>RETAIN&&index.segments.length>1){const first=index.segments.shift()!;removed.push(first);count-=first.last-first.first+1}return removed}
function repairDedup(state:Writer):void {
  const missing=allRows(state.root,state.index).filter(e=>Number(e.cursor.split(':').at(-1))>state.index.dedupThrough)
  if(missing.length){const keys=missing.map(factKey).filter(key=>!hasSeen(state,key));if(keys.length)appendSeen(state,keys)}
  state.index.dedupThrough=state.index.next-1;persistModel(indexPath(state.root),state.index)
}
function migrate(root:string):Index {
  let old:{id:string;next:number;events:ImportedFact[];seen:Record<string,string[]>}|undefined
  try{const path=join(root,'activity.json');if(statSync(path).size>67108864)throw new Error('legacy activity cache is too large');old=JSON.parse(readFileSync(path,'utf8'))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  const previousId=old?.id,keepId=previousId&&/^[A-Za-z0-9-]{1,64}$/.test(previousId)&&!existsSync(segmentDir(root,previousId))
  const id=keepId?previousId!:randomUUID(),events=(old?.events??[]).slice(-RETAIN)
  const first=keepId&&events[0]?Number(events[0].cursor.split(':').at(-1)):1
  const index:Index={version:2,id,next:first,dedupThrough:0,segments:[]}
  const state:Writer={root,index,seen:new Map(),pending:new Map(),onError:()=>{}}
  const rows=events.map((event,n)=>({...event,cursor:cursor(index,first+n),source:event.source??'local'}))
  if(rows.length){appendRows(state,rows);index.next=first+rows.length}
  // Retain the old version's complete hash baseline, even when its fact payloads
  // have already left the 10k tail. Never turn eviction into a new live lease.
  const keys=new Set(rows.map(factKey))
  for(const [address,hashes] of Object.entries(old?.seen??{}))for(const hash of hashes)keys.add(hashOf([address,hash]))
  if(keys.size)appendSeen(state,[...keys])
  index.dedupThrough=index.next-1;persistModel(indexPath(root),index)
  return index
}
export function initializeActivityJournal(onError:(message:string)=>void=()=>{}):void {
  const root=modelRoot()
  if(writer?.root===root){writer.onError=onError;return}
  if(writer)flushActivityJournal()
  mkdirSync(root,{recursive:true,mode:0o700})
  let index:Index
  try{index=readIndex(root)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;index=migrate(root)}
  const state:Writer={root,index,seen:new Map(),pending:new Map(),onError}
  if(index.dedupThrough<index.next-1)repairDedup(state)
  for(const row of allRows(root,index))remember(state,factKey(row))
  writer=state
}
function schedule(state:Writer,delay=20):void {
  if(state.timer)return
  state.timer=setTimeout(()=>{state.timer=undefined;try{flushActivityJournal(1)}catch(error){state.onError(`activity flush: ${String(error)}`);schedule(state,1000)}},delay)
}
/** The hot import/hint path only queues references to an already validated chain. */
export function recordActivity(design:LiveDesign,chain:FdnChain,hashes:readonly string[],options:Options):void {
  if(!options.ownerNodeId||chain.docId()!==design.docId)return
  if(writer?.root!==modelRoot())initializeActivityJournal()
  const state=writer!
  for(const hash of hashes){const key=taskKey(design,hash);if(state.seen.has(key)||state.pending.has(key))continue
    state.pending.set(key,{key,design,chain,hash,options,verified:options.signatureVerified===true||options.signatures?.has(hash)===true,source:options.source??(options.importedHashes?.has(hash)?'import':'local'),observedAt:Date.now()})
    if(state.pending.size>RETAIN)state.pending.delete(state.pending.keys().next().value!)
  }
  if(state.pending.size)schedule(state)
}
/** Bounded batches publish payload bytes before their index, repair a crash window
 * before pruning, and preserve hash dedup independently of payload eviction. */
export function flushActivityJournal(maxBatches=Number.POSITIVE_INFINITY):void {
  const state=writer;if(!state)return
  if(state.timer){clearTimeout(state.timer);state.timer=undefined}
  if(!state.pending.size&&state.index.dedupThrough===state.index.next-1)return
  // Re-read the committed index after any interrupted write before touching a tail.
  state.index=readIndex(state.root)
  if(state.index.dedupThrough<state.index.next-1)repairDedup(state)
  let batches=0
  while(state.pending.size&&batches++<maxBatches){
    const candidates=[...state.pending.values()],live=candidates.filter(t=>t.options.delivery==='live'&&Date.now()-t.observedAt<5000).slice(0,32),selected=new Set(live.map(t=>t.key))
    const tasks=[...live,...candidates.filter(t=>!selected.has(t.key))].slice(0,32),wanted=new Map<FdnChain,Set<string>>(),entries=new Map<string,ChainLogEntry>()
    for(const task of tasks){if(hasSeen(state,task.key)){state.pending.delete(task.key);continue}const set=wanted.get(task.chain)??new Set();set.add(task.hash);wanted.set(task.chain,set)}
    for(const [chain,hashes] of wanted){let before:string|undefined;do{const page=chain.logPage({limit:200,...(before?{before}:{})});for(const entry of page.entries)if(hashes.delete(entry.hash))entries.set(entry.hash,entry);before=page.nextCursor??undefined}while(before&&hashes.size)}
    const rows:ImportedFact[]=[],keys:string[]=[]
    for(const task of tasks){if(!state.pending.has(task.key))continue;const raw=entries.get(task.hash);if(!raw){state.pending.delete(task.key);state.onError('validated activity hash absent from chain');continue}
      const origin=task.verified?raw.originNode:null
      rows.push({version:1,cursor:cursor(state.index,state.index.next+rows.length),document:{workspaceId:task.design.workspace,productId:task.design.product,docId:task.design.docId,ownerNodeId:task.options.ownerNodeId},repo:task.options.repo,originNode:origin?{id:origin,name:origin}:null,originAssurance:origin?'writer-stated':null,signatureVerified:task.verified,source:task.source,entry:{...raw,originNode:origin,boardKeys:(raw as ChainLogEntry&{boardKeys?:string[]}).boardKeys??[]},delivery:task.options.delivery==='live'&&Date.now()-task.observedAt<5000?'live':'baseline',observedAt:task.observedAt});keys.push(task.key)
    }
    if(!rows.length)continue
    appendRows(state,rows);state.index.next+=rows.length;const removed=trimIndex(state.index)
    persistModel(indexPath(state.root),state.index)
    for(const key of keys){state.pending.delete(key);remember(state,key)}
    appendSeen(state,keys);state.index.dedupThrough=state.index.next-1;persistModel(indexPath(state.root),state.index)
    for(const segment of removed)try{unlinkSync(segmentPath(state.root,state.index.id,segment.first))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  }
  if(state.pending.size)schedule(state)
}
export function closeActivityJournal():void {
  const state=writer;if(!state)return
  try{flushActivityJournal(1)}finally{if(state.timer)clearTimeout(state.timer);state.timer=undefined;state.pending.clear();writer=undefined}
}
interface ReaderCache { root:string; signature:string; index:Index; rows:Map<number,{bytes:number;events:ImportedFact[]}> }
let reader:ReaderCache|undefined
export function activityBatch(token?:string,workspace?:string):{events:ImportedFact[];cursor:string}{
  const root=modelRoot(),info=statSync(indexPath(root)),signature=JSON.stringify([info.ino,info.mtimeMs,info.size])
  if(reader?.root!==root||reader.signature!==signature){
    const index=readIndex(root),rows=reader?.root===root&&reader.index.id===index.id?reader.rows:new Map<number,{bytes:number;events:ImportedFact[]}>()
    const active=new Set(index.segments.map(s=>s.first));for(const first of rows.keys())if(!active.has(first))rows.delete(first)
    for(const segment of index.segments){const old=rows.get(segment.first),start=old&&old.bytes<=segment.bytes?old.bytes:0
      if(start===segment.bytes)continue
      const events=parseLines(readRange(segmentPath(root,index.id,segment.first),start,segment.bytes),index,start&&old?segment.first+old.events.length:segment.first)
      rows.set(segment.first,{bytes:segment.bytes,events:start&&old?[...old.events,...events]:events})
    }
    reader={root,signature,index,rows}
  }
  const {index,rows}=reader
  let after=0
  if(token){const prefix=`sync-activity1:${index.id}:`;if(!token.startsWith(prefix)||!/^\d+$/.test(token.slice(prefix.length)))throw new Error('invalid or stale activity cursor; establish a new baseline');after=Number(token.slice(prefix.length));const floor=index.segments[0]?.first??index.next;if(!Number.isSafeInteger(after)||after<floor-1||after>=index.next)throw new Error('invalid or stale activity cursor; establish a new baseline')}
  const events=index.segments.flatMap(s=>rows.get(s.first)!.events).filter(e=>Number(e.cursor.split(':').at(-1))>after&&(!workspace||e.document.workspaceId===workspace))
  return {events,cursor:cursor(index,index.next-1)}
}
