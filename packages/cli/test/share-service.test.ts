import { createServer } from 'node:http'
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { startShareService, backupShareService, type ShareServiceConfig } from '../src/share/service.js'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn() })
/** Explicit loopback GitHub stub + process-level Comb fixture; SSH verification is real ssh-keygen. */
async function fixture(options: {isPublic?: boolean; publicAccess?: 'repo-read'|'collaborators'; delayAppendMs?: number} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'share-service-')); cleanup.push(() => rm(dir, {recursive: true, force: true}))
  const denied = new Set<string>(), ambiguous = new Set<string>()
  const identities = new Map<string, {id: number; ssh: string; publicSSH: string; ed: {publicKey:KeyObject;privateKey:KeyObject}}>()
  for (const [index, login] of ['writer','reader','stranger'].entries()) {
    const ssh = join(dir,login)
    execFileSync('ssh-keygen',['-q','-t','ed25519','-N','','-f',ssh])
    identities.set(login,{id:index+1,ssh,publicSSH:await readFile(ssh+'.pub','utf8'),ed:generateKeyPairSync('ed25519')})
  }
  let committed: any
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
    if(path.endsWith('/contents/.foundation/share.json')) {if(!committed){res.writeHead(404).end('{}');return}res.end(JSON.stringify({type:'file',path:'.foundation/share.json',encoding:'base64',content:Buffer.from(JSON.stringify(committed)).toString('base64')}));return}
    if (path.startsWith('/repos/')) { res.end(JSON.stringify({private:!options.isPublic}));return }
    res.writeHead(404).end('{}')
  })
  await new Promise<void>(r => github.listen(0,'127.0.0.1',r))
  cleanup.push(() => new Promise<void>(r => github.close(() => r())))
  const bridge = join(dir,'bridge.mjs')
  await writeFile(bridge, `import {createInterface} from 'node:readline';import {readFileSync,writeFileSync} from 'node:fs';const file=${JSON.stringify(join(dir,'backend.json'))};createInterface({input:process.stdin}).on('line',async line=>{const r=JSON.parse(line);let state={};try{state=JSON.parse(readFileSync(file,'utf8'))}catch{};let x={v:1,id:r.id,op:r.op,ok:true,log:r.log};if(r.op==='hello')Object.assign(x,{protocol:1,capabilities:{durable_idempotency:true,bounded_memory_read:true}});else {const events=state[r.log]??=[];if(r.op==='append'){writeFileSync(${JSON.stringify(join(dir,'append-started'))},'started');await new Promise(r=>setTimeout(r,${options.delayAppendMs ?? 0}));let index=events.findIndex(e=>e.idempotency_key===r.idempotency_key);if(index>=0&&events[index].payload_hex!==r.payload_hex){process.stdout.write(JSON.stringify({v:1,id:r.id,ok:false,error:{code:'idempotency_conflict'}})+'\\n');return}if(index<0){index=events.length;events.push({seq:String(index+1),payload_hex:r.payload_hex,idempotency_key:r.idempotency_key});writeFileSync(file,JSON.stringify(state))}Object.assign(x,{first:String(index+1),last:String(index+1),cursor:String(index+2)})}else if(r.op==='head')x.cursor=String(events.length+1);else Object.assign(x,{events:events.slice(Number(r.cursor)-1),next_cursor:String(events.length+1)})}process.stdout.write(JSON.stringify(x)+'\\n')});`)
  const config: ShareServiceConfig = {stateDir:join(dir,'state'),comb:{binary:process.execPath,args:[bridge]},githubPermissionToken:'operator-metadata-only',githubApiUrl:`http://127.0.0.1:${(github.address() as any).port}`}
  let service=await startShareService(config);config.publicUrl=service.url;cleanup.push(() => service.close())
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
  committed={version:1,mode:"self-hosted",encryption:"e2e-v1",service:service.url,space:space.space,repo:space.repo}
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
  return {setCommitted:(value:any)=>{committed=value},get committed(){return committed},dir,config,api,space,identities,device,writer,token,tokenBody,proof,wrap,keys,payload,append,denied,ambiguous,requests,get service(){return service},restart:async()=>{await service.close();service=await startShareService(config)}}
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
it('refuses public repo-read creation and renewal but preserves private compatibility', async () => {
  const strict=await fixture({isPublic:true})
  const challenge=(await strict.api('challenge?repo='+strict.space.repo)).body.challenge
  const refused=await strict.api('spaces',{repo:strict.space.repo,device:strict.writer,challenge,proof:strict.proof(strict.writer,challenge),publicAccess:'repo-read'})
  expect(refused.status).toBe(400)
  expect(JSON.stringify(refused.body)).toContain('repo-read is only allowed for private repositories')
  expect((await strict.api('token',await strict.tokenBody(strict.device('stranger')))).status).toBe(403)
  expect((await strict.api('token',await strict.tokenBody(strict.device('reader')))).body.permission).toBe('read')
  await strict.restart();const token=(await strict.api('token',await strict.tokenBody())).body.token
  expect((await strict.api('state',undefined,token)).body.publicAccess).toBe('collaborators')
  const legacy=await fixture({publicAccess:'repo-read'})
  expect((await legacy.api('token',await legacy.tokenBody(legacy.device('reader')))).body.permission).toBe('read')
  expect((await legacy.api('token',await legacy.tokenBody(legacy.device('stranger')))).status).toBe(403)
  // A previously private repo becoming public must fail closed on the next token issue.
  const { ShareAuth } = await import('../src/share/auth.js')
  const auth=new ShareAuth({githubApiUrl:strict.config.githubApiUrl,githubPermissionToken:'operator-metadata-only'})
  await expect(auth.permission(strict.space.repo,'writer','repo-read')).rejects.toThrow('repo-read is only allowed for private repositories')
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

it('authenticates encrypted hints without durable append or a cursor receipt',async()=>{
 const f=await fixture();await f.keys()
 const reader=f.device('reader'),read=(await f.api('token',await f.tokenBody(reader))).body.token
 const hint={...f.append(),op:'hint'}
 expect((await f.api('rpc',hint,read)).status).toBe(403)
 expect((await f.api('rpc',{...hint,epoch:0},f.token)).status).toBe(409)
 expect((await f.api('rpc',{...hint,payload_hex:'706c61696e74657874'},f.token)).status).toBe(400)
 const result=await f.api('rpc',hint,f.token);expect(result.status).toBe(200);expect(result.body.accepted).toBe(true);expect(result.body.cursor).toBeUndefined()
 const page=await f.api('rpc',{op:'read',log:'a'.repeat(64),cursor:'1'},f.token)
 expect(page.body.events).toHaveLength(0);expect(page.body.next_cursor).toBe('1')
})

it('requires the committed default-branch descriptor on creation, renewal and existing-token reads', async () => {
  const f=await fixture()
  const valid={...f.committed}
  for (const value of [null,{...valid,space:'sp_wrong'},{...valid,service:'https://other.example'},{...valid,mode:'git-only'}]) {
    f.setCommitted(value)
    const now=Date.now();const clock=vi.spyOn(Date,'now').mockReturnValue(now+31000)
    try {
      expect((await f.api('state',undefined,f.token)).status).toBe(412)
      expect((await f.api('token',await f.tokenBody())).status).toBe(412)
      const challenge=(await f.api('challenge?repo='+f.space.repo)).body.challenge
      expect((await f.api('spaces',{repo:f.space.repo,device:f.writer,challenge,proof:f.proof(f.writer,challenge)})).status).toBe(412)
    } finally {clock.mockRestore()}
  }
  f.setCommitted(valid)
  expect((await f.api('state',undefined,f.token)).status).toBe(200)
  expect(f.requests.filter(r=>r.url.includes('/contents/')).every(r=>r.url.endsWith('/contents/.foundation/share.json')&&r.authorization==='Bearer operator-metadata-only')).toBe(true)
})
it('pins the operator service origin and optionally restricts repository owners', async () => {
  const f=await fixture()
  await f.service.close()
  const restricted=await startShareService({...f.config,allowedRepoOwners:['OTHER'],publicUrl:'https://canonical.example'})
  cleanup.push(()=>restricted.close())
  const challenge=await fetch(restricted.url+'/v1/challenge?repo=github.com/team/repo')
  expect(challenge.status).toBe(403)
  await restricted.close()
  const pinned=await startShareService({...f.config,publicUrl:'https://canonical.example'})
  cleanup.push(()=>pinned.close())
  const result=await fetch(pinned.url+'/v1/challenge?space='+f.space.space)
  const nonce=await result.json() as any
  const response=await fetch(pinned.url+'/v1/token',{method:'POST',body:JSON.stringify({space:f.space.space,device:f.writer,challenge:nonce.challenge,proof:f.proof(f.writer,nonce.challenge)})})
  expect(response.status).toBe(403)
  expect(await response.text()).toContain('configured publicUrl')
})

it('atomically rejects a requested space already bound to another repository', async () => {
  const f=await fixture()
  const repo='github.com/team/other'
  const creation=(await f.api(`challenge?repo=${repo}&requestedSpace=${f.space.space}`)).body
  const binding={space:creation.space,repo}
  const writer=f.device('writer',binding)
  f.setCommitted({...f.committed,repo})
  const signature=sign(null,Buffer.from(JSON.stringify(['foundation-auth-v1',writer.service,binding.space,writer.id,creation.challenge])),f.identities.get('writer')!.ed.privateKey).toString('base64')
  const result=await f.api('spaces',{repo,device:writer,challenge:creation.challenge,proof:signature})
  expect(result.status).toBe(409)
  expect(JSON.stringify(result.body)).toContain('space is already bound to another repository')
  expect((await f.api('challenge?space='+f.space.space)).body.repo).toBe(f.space.repo)
})

it('drains an in-flight append, closes SSE promptly and reconnects after restart', async () => {
  const f=await fixture({delayAppendMs:250}); await f.keys()
  const relay=await fetch(f.service.url+'/v1/relay',{headers:{Authorization:`Bearer ${f.token}`}})
  const reader=relay.body!.getReader(); await reader.read()
  const append=f.api('rpc',f.append(),f.token)
  await vi.waitFor(async()=>expect(await readFile(join(f.dir,'append-started'),'utf8')).toBe('started'))
  const started=performance.now()
  const close=f.service.close()
  expect((await append).status).toBe(200)
  await close
  console.log(`H2d append drain: ${Math.round(performance.now()-started)} ms, append=200`)
  expect(performance.now()-started).toBeLessThan(2000)
  let ending=''; for(;;){const row=await reader.read();if(row.done)break;ending+=new TextDecoder().decode(row.value)}
  expect(ending).toContain('event: close')
  f.config.port=Number(new URL(f.service.url).port)
  await f.restart()
  const token=(await f.api('token',await f.tokenBody())).body.token
  expect((await f.api('rpc',{op:'head',log:'a'.repeat(64)},token)).body.cursor).toBe('2')
  const reconnected=await fetch(f.service.url+'/v1/relay',{headers:{Authorization:`Bearer ${token}`}})
  const again=reconnected.body!.getReader()
  expect(new TextDecoder().decode((await again.read()).value)).toContain(': connected')
  await f.service.close(); await again.cancel()
},10000)

it('bounds a stuck append drain to five seconds with an open SSE client', async () => {
  const f=await fixture({delayAppendMs:30000}); await f.keys()
  const relay=await fetch(f.service.url+'/v1/relay',{headers:{Authorization:`Bearer ${f.token}`}})
  const reader=relay.body!.getReader();await reader.read()
  const append=f.api('rpc',f.append(),f.token).catch(()=>null)
  await vi.waitFor(async()=>expect(await readFile(join(f.dir,'append-started'),'utf8')).toBe('started'))
  const started=performance.now()
  const stop=f.service.close();expect(f.service.close()).toBe(stop);await stop
  console.log(`H2d stuck drain: ${Math.round(performance.now()-started)} ms`)
  expect(performance.now()-started).toBeGreaterThanOrEqual(4900)
  expect(performance.now()-started).toBeLessThan(6500)
  await append;await reader.cancel()
},10000)

it('CLI SIGTERM exits zero promptly with active SSE and restarts on the same port', async () => {
  const f=await fixture();f.config.port=Number(new URL(f.service.url).port)
  await f.service.close()
  const configFile=join(f.dir,'config.json');await writeFile(configFile,JSON.stringify(f.config))
  async function launch(){
    const child=spawn(process.execPath,['--import','tsx','packages/cli/src/main.ts','share','serve','--config',configFile],{stdio:['ignore','pipe','pipe']})
    cleanup.push(async()=>{if(child.exitCode===null){child.kill('SIGKILL');await once(child,'exit')}})
    let diagnostic='';child.stderr.on('data',chunk=>{diagnostic+=chunk.toString()})
    await vi.waitFor(()=>expect(diagnostic).toContain('Share service listening:'),{timeout:5000})
    const token=(await f.api('token',await f.tokenBody())).body.token
    const relay=await fetch(f.service.url+'/v1/relay',{headers:{Authorization:`Bearer ${token}`}})
    const reader=relay.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toContain(': connected')
    return {child,reader}
  }
  for(let i=0;i<2;i++){
    const {child,reader}=await launch();const exited=once(child,'exit');const started=performance.now()
    child.kill('SIGTERM')
    expect(await exited).toEqual([0,null])
    console.log(`H2d CLI SIGTERM cycle ${i+1}: ${Math.round(performance.now()-started)} ms, exit=0, SSE reconnected`)
    expect(performance.now()-started).toBeLessThan(2000)
    let ending='';for(;;){const row=await reader.read();if(row.done)break;ending+=new TextDecoder().decode(row.value)}
    expect(ending).toContain('event: close')
  }
},15000)
