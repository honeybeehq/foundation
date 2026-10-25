/** Immutable design-relative image files. Chunk payloads use the ordinary signed,
 * encrypted share transport; neither the content hash nor path reaches the store. */
import { constants } from 'node:fs'
import { open, lstat, mkdir, realpath, readdir, link, unlink, copyFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, relative, isAbsolute } from 'node:path'
import type { FdnChain } from 'foundation-engine'
import type { CombConfig } from '../sync/daemon.js'
import { createBridge } from './transport.js'
import { validateAppendReceipt } from '../sync/bridge.js'

export const MAX_ASSET = 20 * 1024 * 1024
const CHUNK = 128 * 1024
const PREFIX = '.foundation/assets/'
const NAME = /^([a-f0-9]{64})\.(png|jpg|gif|webp|avif|svg)$/
export interface AssetRef { hash: string; ext: string; path: string }
export function assetRef(path: string): AssetRef {
  const match = path.startsWith(PREFIX) && NAME.exec(path.slice(PREFIX.length))
  if (!match) throw new Error('invalid design-relative asset path')
  return { hash: match[1]!, ext: match[2]!, path }
}
/** Only contract-local strings and CSS url() values are references; remote URLs
 * and original-source metadata are never fetched by sync. */
export function assetReferences(document: unknown): AssetRef[] {
  const refs = new Map<string, AssetRef>()
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      const pattern = /(?:^|[\s("'])(\.foundation\/assets\/[^\s)"']+)(?=$|[\s)"'])/g
      for (const match of value.matchAll(pattern)) { const ref = assetRef(match[1]!); refs.set(ref.path, ref) }
    } else if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(document)
  return [...refs.values()]
}
export function sniffAsset(bytes: Uint8Array): string {
  const b = Buffer.from(bytes)
  if (b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) return 'png'
  if (b[0]===0xff && b[1]===0xd8 && b[2]===0xff) return 'jpg'
  if (['GIF87a','GIF89a'].includes(b.subarray(0,6).toString('ascii'))) return 'gif'
  if (b.subarray(0,4).toString()==='RIFF' && b.subarray(8,12).toString()==='WEBP') return 'webp'
  if (b.subarray(4,8).toString()==='ftyp' && /avif|avis/.test(b.subarray(8,64).toString('ascii'))) return 'avif'
  const text=b.toString('utf8').replace(/^\uFEFF/,'').trimStart()
  if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(text)) return 'svg'
  throw new Error('unsupported asset image signature')
}
async function confinedPath(file: string, repoRoot: string, ref: AssetRef, create: boolean): Promise<string> {
  const root=await realpath(repoRoot), parent=await realpath(dirname(file)), rel=relative(root,parent)
  if (isAbsolute(rel)||rel.split(/[\\/]/).includes('..')) throw new Error('asset directory escapes repository')
  let current=parent
  for (const part of ['.foundation','assets']) {
    current=join(current,part)
    if(create)await mkdir(current,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e})
    const stat=await lstat(current)
    if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('asset directories cannot be symlinks')
  }
  return join(current,`${ref.hash}.${ref.ext}`)
}
async function verifyFile(path: string, ref: AssetRef): Promise<number> {
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW)
  try {
    const stat=await handle.stat()
    if(!stat.isFile()||stat.size<1||stat.size>MAX_ASSET)throw new Error('asset exceeds20MiB or is not a regular image file')
    const hash=createHash('sha256'), first=Buffer.alloc(4096)
    let size=0, firstSize=0
    for await(const bytes of handle.createReadStream({autoClose:false,highWaterMark:CHUNK})) {
      hash.update(bytes);size+=bytes.length
      if(size>MAX_ASSET)throw new Error('asset exceeds20MiB')
      if(firstSize<first.length){const count=Math.min(first.length-firstSize,bytes.length);bytes.copy(first,firstSize,0,count);firstSize+=count}
    }
    if(size!==stat.size||hash.digest('hex')!==ref.hash||sniffAsset(first.subarray(0,firstSize))!==ref.ext)throw new Error('asset hash, length or image type mismatch')
    return size
  } finally { await handle.close() }
}
const address=(ref:AssetRef,index:number):string=>`foundation-share-asset-v1:${ref.hash}.${ref.ext}:${index}`
const logFor=(ref:AssetRef,index:number):string=>'foundation-'+createHash('sha256').update(address(ref,index)).digest('hex')
const acknowledged=new Set<string>()
function chunk(ref:AssetRef,size:number,index:number,bytes:Buffer):Buffer {
  const header=Buffer.from(JSON.stringify({v:1,hash:ref.hash,ext:ref.ext,size,index,count:Math.ceil(size/CHUNK)})), length=Buffer.alloc(4)
  length.writeUInt32LE(header.length);return Buffer.concat([length,header,bytes])
}
function decode(bytes:Buffer,ref:AssetRef):{size:number;index:number;count:number;bytes:Buffer} {
  if(bytes.length<5||bytes.length>CHUNK+4096)throw new Error('invalid asset chunk size')
  const n=bytes.readUInt32LE(0)
  if(n<1||n>4092||n>bytes.length-4)throw new Error('invalid asset chunk header')
  const h=JSON.parse(bytes.subarray(4,4+n).toString('utf8'))
  if(h.v!==1||h.hash!==ref.hash||h.ext!==ref.ext||!Number.isSafeInteger(h.size)||h.size<1||h.size>MAX_ASSET||!Number.isSafeInteger(h.index)||h.index<0||h.count!==Math.ceil(h.size/CHUNK)||h.index>=h.count)throw new Error('asset chunk metadata mismatch')
  const data=bytes.subarray(4+n)
  if(data.length!==Math.min(CHUNK,h.size-h.index*CHUNK))throw new Error('asset chunk length mismatch')
  return {size:h.size,index:h.index,count:h.count,bytes:data}
}
export class AssetSharing {
  private uploaded=new Set<string>()
  private available=new Set<string>()
  constructor(private config:CombConfig,private file:string,private root:string) {}
  /** Retained directory files include old references needed by undo. Never GC. */
  async publish(chain:FdnChain):Promise<void> {
    if(!this.config.share)return
    // Undo on a newly materialized replica may reintroduce a historical image.
    // Fetch that immutable blob before publishing its reference again.
    await this.receive(chain)
    const refs=new Map(assetReferences(chain.doc()).map(ref=>[ref.path,ref]))
    const dir=join(dirname(this.file),PREFIX)
    try { for(const name of await readdir(dir))if(NAME.test(name)){const ref=assetRef(PREFIX+name);refs.set(ref.path,ref)} }
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    for(const ref of refs.values()) {
      const ack=JSON.stringify([this.config.share.space,this.config.share.service,this.root,ref.path])
      if(this.uploaded.has(ref.path)||acknowledged.has(ack)){this.uploaded.add(ref.path);continue}
      await transfer(async()=>{
      const path=await confinedPath(this.file,this.root,ref,false),size=await verifyFile(path,ref)
      const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW)
      try {
          let index=0,total=0;const hash=createHash('sha256')
          for await(const bytes of handle.createReadStream({autoClose:false,highWaterMark:CHUNK})) {
            if(total+bytes.length>size)throw new Error('asset changed during upload')
            const bridge=createBridge({...this.config,shareLog:address(ref,index)}),log=logFor(ref,index)
            const payload=chunk(ref,size,index++,bytes);total+=bytes.length;hash.update(bytes)
            const identity=createHash('sha256').update(payload).digest('hex')
            try{await bridge.hello();validateAppendReceipt(await bridge.request('append',{log,idempotency_key:identity,payload_hex:payload.toString('hex')}),log)}finally{await bridge.finish()}
          }
          if(total!==size||hash.digest('hex')!==ref.hash)throw new Error('asset changed during upload')
      } finally {await handle.close()}
        this.uploaded.add(ref.path);acknowledged.add(ack)
      })
    }
  }
  hintsReady(chain:FdnChain):boolean {return assetReferences(chain.doc()).every(ref=>this.uploaded.has(ref.path))}
  async receive(chain:FdnChain):Promise<void> {
    if(!this.config.share)return
    for(const ref of assetReferences(chain.doc())) {
      if(this.available.has(ref.path))continue
      const target=await confinedPath(this.file,this.root,ref,true)
      try {await verifyFile(target,ref);this.available.add(ref.path);continue}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
      await fetchAsset(this.config,target,ref)
      this.available.add(ref.path)
    }
  }
}
// A large image never opens unbounded streams or monopolizes every connection.
let activeTransfers=0
const waitingTransfers:Array<()=>void>=[]
async function transfer<T>(run:()=>Promise<T>):Promise<T> {
  if(activeTransfers>=2){if(waitingTransfers.length>=32)throw new Error('asset transfers busy; retry after pending images finish');await new Promise<void>(resolve=>waitingTransfers.push(resolve))}
  else activeTransfers++
  try{return await run()}finally{const next=waitingTransfers.shift();if(next)next();else activeTransfers--}
}
async function cleanDeadTemps(dir:string):Promise<void> {
  for(const name of await readdir(dir)) {
    const match=/^\.asset-(\d+)-[a-f0-9-]+\.tmp$/.exec(name)
    if(!match)continue
    try{process.kill(Number(match[1]),0)}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')await unlink(join(dir,name)).catch(()=>{})}
  }
}
const downloads=new Map<string,Promise<void>>()
async function fetchAsset(config:CombConfig,target:string,ref:AssetRef):Promise<void> {
  const id=JSON.stringify([config.share!.space,target]),old=downloads.get(id)
  if(old)return old
  const task=transfer(()=>download(config,target,ref)).finally(()=>downloads.delete(id));downloads.set(id,task);return task
}
async function download(config:CombConfig,target:string,ref:AssetRef):Promise<void> {
  await cleanDeadTemps(dirname(target))
  const temporary=join(dirname(target),`.asset-${process.pid}-${randomUUID()}.tmp`),handle=await open(temporary,'wx',0o600)
  try {
    let size:number|undefined,count:number|undefined,index=0
    const hash=createHash('sha256')
    do {
      const bridge=createBridge({...config,shareLog:address(ref,index)}),log=logFor(ref,index)
      try {
        await bridge.hello()
        const head=await bridge.request('head',{log})
        if(head.log!==log||typeof head.cursor!=='string'||!/^\d+$/.test(head.cursor)||BigInt(head.cursor)<2n||BigInt(head.cursor)>65n)throw new Error('asset chunk missing or history too large')
        const page=await bridge.request('read',{log,cursor:'1',max_events:1,max_bytes:491520}),events=page.events as {seq:string;payload_hex:string}[]
        if(page.log!==log||!Array.isArray(events)||events.length!==1||events[0]!.seq!=='1'||page.next_cursor!=='2')throw new Error('asset chunk cursor gap')
        const item=decode(Buffer.from(events[0]!.payload_hex,'hex'),ref)
        if(item.index!==index)throw new Error('asset chunk missing or reordered')
        if(size!==undefined&&(item.size!==size||item.count!==count))throw new Error('asset metadata changed')
        size=item.size;count=item.count
        await handle.writeFile(item.bytes);hash.update(item.bytes);index++
      }finally{bridge.close()}
    }while(index<count!)
    if(hash.digest('hex')!==ref.hash)throw new Error('asset hash mismatch')
    await handle.sync();await handle.close();await verifyFile(temporary,ref)
    try {await link(temporary,target)}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;await verifyFile(target,ref)}
    const dir=await open(dirname(target),'r');try{await dir.sync()}finally{await dir.close()}
  } finally {await handle.close().catch(()=>{});await unlink(temporary).catch(()=>{})}
}

/** A complete local replica can materialize offline only with its image files. */
export async function copyCachedAssets(chain:FdnChain,source:string,target:string,root:string):Promise<void> {
  for(const ref of assetReferences(chain.doc())) {
    const from=await confinedPath(source,root,ref,false),to=await confinedPath(target,root,ref,true)
    await verifyFile(from,ref)
    if(from===to)continue
    try{await verifyFile(to,ref);continue}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    const temp=join(dirname(to),`.asset-${process.pid}-${randomUUID()}.tmp`)
    try{await copyFile(from,temp,constants.COPYFILE_EXCL);await verifyFile(temp,ref);try{await link(temp,to)}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;await verifyFile(to,ref)}}finally{await unlink(temp).catch(()=>{})}
  }
}
