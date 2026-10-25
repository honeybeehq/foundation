import { createServer } from 'node:http'
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { startShareService, backupShareService, type ShareServiceConfig } from '../src/share/service.js'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn() })
/** Explicit loopback GitHub stub + process-level Comb fixture; SSH verification is real ssh-keygen. */
async function fixture(options: {isPublic?: boolean; publicAccess?: 'repo-read'|'collaborators'} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'share-service-')); cleanup.push(() => rm(dir, {recursive: true, force: true}))
  const denied = new Set<string>(), ambiguous = new Set<string>()
  const identities = new Map<string, {id: number; ssh: string; publicSSH: string; ed: {publicKey:KeyObject;privateKey:KeyObject}}>()
  for (const [index, login] of ['writer','reader','stranger'].entries()) {
    const ssh = join(dir,login)
    execFileSync('ssh-keygen',['-q','-t','ed25519','-N','','-f',ssh])
    identities.set(login,{id:index+1,ssh,publicSSH:await readFile(ssh+'.pub','utf8'),ed:generateKeyPairSync('ed25519')})
  }
  const requests: {url: string; authorization?: string}[] = []
  const github = createServer((req, res) => {
    const path = req.url!; requests.push({url:path,authorization:req.headers.authorization})
    if (/^\/[a-z]+\.keys$/.test(path)) { res.end(identities.get(path.slice(1,-5))?.publicSSH ?? ''); return }
    res.setHeader('Content-Type','application/json')
    if (path.startsWith('/users/')) { const login=path.slice(7); res.end(JSON.stringify({login,id:identities.get(login)?.id})); return }
    if(path.includes('/collaborators?')){if(ambiguous.size){res.writeHead(403).end('{}');return}res.end(JSON.stringify(['writer','reader'].filter(login=>!denied.has(login)).map(login=>({login,id:identities.get(login)!.id,permissions:{push:login==='writer'}}))));return}
    const match = path.match(/\/collaborators\/([^/]+)\/permission$/)
    if (match) {
      const login=match[1]!
      if (ambiguous.has(login)) {res.writeHead(404).end('{}');return}
      res.end(JSON.stringify({permission:denied.has(login) ? 'none' : login==='writer' ? 'write' : login==='reader' ? 'read' : 'none'}));return
    }
    if (path.startsWith('/repos/')) { res.end(JSON.stringify({private:!options.isPublic}));return }
    res.writeHead(404).end('{}')
  })
  await new Promise<void>(r => github.listen(0,'127.0.0.1',r))
  cleanup.push(() => new Promise<void>(r => github.close(() => r())))
  const bridge = join(dir,'bridge.mjs')
  await writeFile(bridge, `import {createInterface} from 'node:readline';import {readFileSync,writeFileSync} from 'node:fs';const file=${JSON.stringify(join(dir,'backend.json'))};createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);let state={};try{state=JSON.parse(readFileSync(file,'utf8'))}catch{};let x={v:1,id:r.id,op:r.op,ok:true,log:r.log};if(r.op==='hello')Object.assign(x,{protocol:1,capabilities:{durable_idempotency:true,bounded_memory_read:true}});else {const events=state[r.log]??=[];if(r.op==='append'){let index=events.findIndex(e=>e.idempotency_key===r.idempotency_key);if(index>=0&&events[index].payload_hex!==r.payload_hex){process.stdout.write(JSON.stringify({v:1,id:r.id,ok:false,error:{code:'idempotency_conflict'}})+'\\n');return}if(index<0){index=events.length;events.push({seq:String(index+1),payload_hex:r.payload_hex,idempotency_key:r.idempotency_key});writeFileSync(file,JSON.stringify(state))}Object.assign(x,{first:String(index+1),last:String(index+1),cursor:String(index+2)})}else if(r.op==='head')x.cursor=String(events.length+1);else Object.assign(x,{events:events.slice(Number(r.cursor)-1),next_cursor:String(events.length+1)})}process.stdout.write(JSON.stringify(x)+'\\n')});`)
  const config: ShareServiceConfig = {stateDir:join(dir,'state'),comb:{binary:process.execPath,args:[bridge]},githubPermissionToken:'operator-metadata-only',githubApiUrl:`http://127.0.0.1:${(github.address() as any).port}`}
  let service=await startShareService(config);cleanup.push(() => service.close())
  async function api(path: string, body?: any, token?: string) {
    const result=await fetch(service.url+'/v1/'+path,{method:body===undefined?'GET':'POST',headers:token?{Authorization:`Bearer ${token}`}:{},body:body===undefined?undefined:JSON.stringify(body)})
    return {status:result.status,body:await result.json() as any}
  }
  let space: {space:string;repo:string;publicAccess?:string}
  function device(login='writer', binding=space) {
    const identity=identities.get(login)!
    const boxPublicKey=Buffer.alloc(32,1).toString('base64'),signPublicKey=identity.ed.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64')
    const canonical=JSON.stringify(['foundation-device-v1',service.url,binding.space,binding.repo,login,identity.id,boxPublicKey,signPublicKey])
    const signature=execFileSync('ssh-keygen',['-Y','sign','-f',identity.ssh,'-n','foundation-share'],{input:canonical,stdio:['pipe','pipe','ignore']}).toString()
    return {id:createHash('sha256').update(canonical).digest('hex'),service:service.url,login,githubId:identity.id,boxPublicKey,signPublicKey,signature}
  }
  const proof = (d: ReturnType<typeof device>, challenge:string) => sign(null,Buffer.from(JSON.stringify(['foundation-auth-v1',d.service,space.space,d.id,challenge])),identities.get(d.login)!.ed.privateKey).toString('base64')
  const creation=(await api('challenge?repo=github.com/team/repo')).body
  space=creation
  const writer=device()
  expect((await api('spaces',{repo:space.repo,device:writer,challenge:creation.challenge,proof:proof(writer,creation.challenge),publicAccess:options.publicAccess})).status).toBe(200)
  async function tokenBody(d=writer) {
    const challenge=(await api('challenge?space='+space.space)).body.challenge
    return {space:space.space,device:d,challenge,proof:proof(d,challenge)}
  }
  const token=(await api('token',await tokenBody())).body.token
  const wrap=(id=writer.id,epoch=1) => ({epoch,deviceId:id,senderId:writer.id,box:Buffer.alloc(64).toString('base64'),signature:Buffer.alloc(64).toString('base64')})
  const keys=() => api('keys',{expectedEpoch:0,epoch:1,wraps:[wrap()]},token)
  const payload=(epoch=1) => Buffer.from(JSON.stringify({v:1,epoch,dedup:'b'.repeat(64),nonce:Buffer.alloc(24).toString('base64'),ciphertext:Buffer.alloc(32).toString('base64'),keyId:'c'.repeat(32),senderId:writer.id,signature:Buffer.alloc(64).toString('base64')})).toString('hex')
  const append=(epoch=1) => ({op:'append',log:'a'.repeat(64),idempotency_key:'b'.repeat(64),payload_hex:payload(epoch),epoch})
  return {dir,config,api,space,identities,device,writer,token,tokenBody,proof,wrap,keys,payload,append,denied,ambiguous,requests,get service(){return service},restart:async()=>{await service.close();service=await startShareService(config)}}
}
it('authenticates SSH-bound devices with single-use Ed25519 proof without user credentials', async () => {
  const f=await fixture()
  const body=await f.tokenBody()
  expect((await f.api('token',body,'repo-scoped-user-secret')).status).toBe(400)
  expect((await f.api('token',body)).status).toBe(200)
  expect((await f.api('token',body)).status).toBe(401)
  expect((await f.api('token',{...await f.tokenBody(),proof:Buffer.alloc(64).toString('base64')})).status).toBe(401)
  const mismatched={...f.writer,githubId:999}
  expect((await f.api('token',await f.tokenBody(mismatched))).status).toBe(400)
  const forged={...f.writer,signature:f.device('reader').signature}
  expect((await f.api('token',await f.tokenBody(forged))).status).toBe(403)
  expect(f.requests.filter(r=>r.url.endsWith('.keys')).every(r=>!r.authorization)).toBe(true)
  expect(f.requests.filter(r=>!r.url.endsWith('.keys')).every(r=>r.authorization==='Bearer operator-metadata-only')).toBe(true)
  expect(f.requests.some(r=>r.url==='/user')).toBe(false)
  const creation=(await f.api('challenge?repo='+f.space.repo)).body
  const reader=f.device('reader')
  expect((await f.api('spaces',{repo:f.space.repo,device:reader,challenge:creation.challenge,proof:f.proof(reader,creation.challenge)})).status).toBe(403)
})
it('expires challenges and binds their action and target space', async () => {
  const f=await fixture();const body=await f.tokenBody()
  const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+61000)
  expect((await f.api('token',body)).status).toBe(401);vi.restoreAllMocks()
  const create=(await f.api('challenge?repo='+f.space.repo)).body
  expect((await f.api('token',{space:f.space.space,device:f.writer,challenge:create.challenge,proof:f.proof(f.writer,create.challenge)})).status).toBe(401)
  expect((await f.api('token',{...await f.tokenBody(),space:'sp_other'})).status).toBe(401)
})
it('checks permission on every issuance and distinguishes read handover from write operations', async () => {
  const f=await fixture();const reader=f.device('reader')
  const read=await f.api('token',await f.tokenBody(reader));expect(read.body.permission).toBe('read')
  expect(read.body.expiresAt-Date.now()).toBeGreaterThan(3590000)
  expect((await f.api('keys',{expectedEpoch:0,epoch:1,wraps:[]},read.body.token)).status).toBe(403)
  await f.keys()
  expect((await f.api('keys',{expectedEpoch:1,epoch:1,wraps:[{...f.wrap(reader.id),senderId:reader.id}]},read.body.token)).status).toBe(200)
  expect((await f.api('keys',{expectedEpoch:1,epoch:1,recoveryPublicKey:Buffer.alloc(32).toString('base64'),wraps:[]},read.body.token)).status).toBe(403)
  expect((await f.api('rpc',f.append(),read.body.token)).status).toBe(403)
  expect((await f.api('state?space=sp_wrong',undefined,read.body.token)).status).toBe(403)
})
it('persists confirmed access loss, closes old tokens and blocks appends until rotation', async () => {
  const f=await fixture();await f.keys();const reader=f.device('reader')
  const read=(await f.api('token',await f.tokenBody(reader))).body.token
  f.ambiguous.add('reader');expect((await f.api('token',await f.tokenBody(reader))).status).toBe(502)
  expect((await f.api('state',undefined,f.token)).body.accessLost).toEqual([])
  f.ambiguous.clear();f.denied.add('reader')
  expect((await f.api('token',await f.tokenBody(reader))).status).toBe(403)
  expect((await f.api('state',undefined,read)).status).toBe(403)
  expect((await f.api('state',undefined,f.token)).body.accessLost).toEqual([reader.id])
  expect((await f.api('rpc',f.append(),f.token)).status).toBe(409)
  await f.restart();const token=(await f.api('token',await f.tokenBody())).body.token
  expect((await f.api('state',undefined,token)).body.accessLost).toEqual([reader.id])
  expect((await f.api('keys',{expectedEpoch:1,epoch:2,revoke:[reader.id,'d'.repeat(64)],wraps:[f.wrap(f.writer.id,2)]},token)).status).toBe(200)
  expect((await f.api('state',undefined,token)).body.accessLost).toEqual([])
  expect((await f.api('rpc',f.append(2),token)).status).toBe(200)
})
it('allows explicit public repo read and defaults new spaces to collaborators', async () => {
  const f=await fixture({isPublic:true,publicAccess:'repo-read'});const stranger=f.device('stranger')
  expect((await f.api('token',await f.tokenBody(stranger))).body.permission).toBe('read')
  const strict=await fixture({isPublic:true})
  expect((await strict.api('token',await strict.tokenBody(strict.device('stranger')))).status).toBe(403)
  await strict.restart();const token=(await strict.api('token',await strict.tokenBody())).body.token
  expect((await strict.api('state',undefined,token)).body.publicAccess).toBe('collaborators')
})
it('rejects malformed ciphertext and preserves durable receipts and replay', async () => {
  const f=await fixture();await f.keys()
  const record=JSON.parse(Buffer.from(f.payload(),'hex').toString())
  for (const payload_hex of [Buffer.from('plaintext').toString('hex'),Buffer.from(JSON.stringify({...record,plaintext:'secret'})).toString('hex'),Buffer.from(JSON.stringify({...record,senderId:'d'.repeat(64)})).toString('hex')]) expect((await f.api('rpc',{...f.append(),payload_hex},f.token)).status).toBe(400)
  expect((await f.api('rpc',{...f.append(),log:'../physical'},f.token)).status).toBe(400)
  const receipt=await f.api('rpc',f.append(),f.token);expect(receipt.status).toBe(200);expect(receipt.body.first).toBe('1');expect(receipt.body.log).toBe('a'.repeat(64))
  expect((await f.api('rpc',f.append(),f.token)).body.first).toBe('1')
  const alternate=JSON.parse(Buffer.from(f.payload(),'hex').toString());alternate.nonce=Buffer.alloc(24,2).toString('base64');alternate.ciphertext=Buffer.alloc(32,3).toString('base64')
  const duplicate={...f.append(),payload_hex:Buffer.from(JSON.stringify(alternate)).toString('hex')}
  expect((await f.api('rpc',duplicate,f.token)).body.first).toBe('1')
  await f.restart();expect((await f.api('state',undefined,f.token)).status).toBe(401)
  const token=(await f.api('token',await f.tokenBody())).body.token
  const read=await f.api('rpc',{op:'read',log:'a'.repeat(64),cursor:'1'},token)
  expect(read.body.events).toHaveLength(1);expect(read.body.events[0].payload_hex).toBe(f.payload())
  expect((await f.api('rpc',duplicate,token)).body.first).toBe('1')
})
it('rotates with CAS, validates recovery and revokes tokens and relay', async () => {
  const f=await fixture();const reader=f.device('reader'),read=(await f.api('token',await f.tokenBody(reader))).body.token
  const recoveryPublicKey=Buffer.alloc(32,3).toString('base64')
  expect((await f.api('keys',{expectedEpoch:0,epoch:1,recoveryPublicKey,wraps:[f.wrap(),f.wrap('recovery')]},f.token)).status).toBe(200)
  expect((await f.keys()).status).toBe(409)
  const controller=new AbortController(),relay=await fetch(f.service.url+'/v1/relay',{headers:{Authorization:`Bearer ${read}`},signal:controller.signal})
  const stream=relay.body!.getReader();await stream.read()
  expect((await f.api('keys',{expectedEpoch:1,epoch:1,revoke:[reader.id],wraps:[]},f.token)).status).toBe(400)
  expect((await f.api('keys',{expectedEpoch:1,epoch:2,revoke:[reader.id],wraps:[f.wrap(f.writer.id,2),f.wrap('recovery',2)]},f.token)).status).toBe(200)
  expect((await stream.read()).done).toBe(true);controller.abort()
  expect((await f.api('state',undefined,read)).status).toBe(403)
  expect((await f.api('token',await f.tokenBody(reader))).status).toBe(403)
  expect((await f.api('rpc',f.append(),f.token)).status).toBe(409)
  expect((await f.api('keys',{expectedEpoch:2,epoch:2,recoveryPublicKey:Buffer.alloc(32,4).toString('base64'),wraps:[]},f.token)).status).toBe(400)
  expect((await f.api('keys',{expectedEpoch:2,epoch:3,recoveryPublicKey:Buffer.alloc(32,4).toString('base64'),wraps:[f.wrap(f.writer.id,3),f.wrap('recovery',3)]},f.token)).status).toBe(200)
})
it('exports complete stopped local backups and refuses remote GitHub overrides', async () => {
  const f=await fixture();await f.keys()
  await expect(startShareService({...f.config,stateDir:join(f.dir,'other'),githubApiUrl:'https://example.com'})).rejects.toThrow('loopback')
  await expect(backupShareService(f.config,join(f.dir,'backup'))).rejects.toThrow('stop service')
  const backend=join(f.dir,'objects');await mkdir(backend);await writeFile(join(backend,'encrypted-object'),'ciphertext')
  f.config.backupLocalStore=backend
  await f.service.close();await backupShareService(f.config,join(f.dir,'backup'))
  const manifest=JSON.parse(await readFile(join(f.dir,'backup','BACKUP.json'),'utf8'));expect(manifest.backendIncluded).toBe(true);expect(await readFile(join(f.dir,'backup/comb-store/encrypted-object'),'utf8')).toBe('ciphertext')
  const metadata=await readFile(join(f.dir,'backup','metadata.json'),'utf8');expect(metadata).toContain(f.writer.id);expect(metadata).not.toContain(f.token);expect(metadata).not.toContain('operator-metadata-only')
})

it('accepts a fresh SSH attestation for immutable device keys and publishes it to peers',async()=>{
 const f=await fixture(),reader=f.device('reader')
 expect((await f.api('token',await f.tokenBody(reader))).status).toBe(200)
 const identity=f.identities.get('reader')!,ssh=join(f.dir,'reader-new-ssh')
 execFileSync('ssh-keygen',['-q','-t','ed25519','-N','','-f',ssh]);identity.ssh=ssh;identity.publicSSH=await readFile(ssh+'.pub','utf8')
 expect((await f.api('token',await f.tokenBody(reader))).status).toBe(403)
 const renewed=f.device('reader');expect(renewed.id).toBe(reader.id)
 expect((await f.api('token',await f.tokenBody(renewed))).status).toBe(200)
 const state=await f.api('state',undefined,f.token);expect(state.body.devices.find((d:any)=>d.id===reader.id).signature).toBe(renewed.signature)
})
