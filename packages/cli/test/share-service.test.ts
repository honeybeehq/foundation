import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { startShareService, backupShareService, type ShareServiceConfig } from '../src/share/service.js'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'share-service-')); cleanup.push(() => rm(dir, {recursive: true, force: true}))
  const denied = new Set<string>()
  const github = createServer((req, res) => {
    const token = req.headers.authorization?.slice(7) ?? ''
    res.setHeader('Content-Type', 'application/json')
    if (denied.has(token) || token === 'denied') { res.writeHead(404).end('{}'); return }
    res.end(JSON.stringify(req.url === '/user' ? {login: token, id: token === 'writer' ? 1 : 2} : {permissions: {pull: true, push: token === 'writer'}}))
  })
  await new Promise<void>(r => github.listen(0, '127.0.0.1', r))
  cleanup.push(() => new Promise<void>(r => github.close(() => r())))
  const bridge = join(dir, 'bridge.mjs')
  await writeFile(bridge, `import {createInterface} from 'node:readline';import {readFileSync,writeFileSync} from 'node:fs';const file=${JSON.stringify(join(dir, 'backend.json'))};createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);let state={};try{state=JSON.parse(readFileSync(file,'utf8'))}catch{};let x={v:1,id:r.id,op:r.op,ok:true,log:r.log};if(r.op==='hello')Object.assign(x,{protocol:1,capabilities:{durable_idempotency:true,bounded_memory_read:true}});else {const events=state[r.log]??=[];if(r.op==='append'){let index=events.findIndex(e=>e.idempotency_key===r.idempotency_key);if(index<0){index=events.length;events.push({sequence:String(index+1),payload_hex:r.payload_hex,idempotency_key:r.idempotency_key});writeFileSync(file,JSON.stringify(state))}Object.assign(x,{first:String(index+1),last:String(index+1),cursor:String(index+2)})}else if(r.op==='head')x.next_cursor=String(events.length+1);else Object.assign(x,{events:events.slice(Number(r.cursor)-1),next_cursor:String(events.length+1)})}process.stdout.write(JSON.stringify(x)+'\\n')});`)
  const config: ShareServiceConfig = {stateDir: join(dir, 'state'), comb: {binary: process.execPath, args: [bridge]}, githubApiUrl: `http://127.0.0.1:${(github.address() as any).port}`}
  let service = await startShareService(config)
  cleanup.push(() => service.close())
  async function api(path: string, body?: any, token = 'writer') {
    const result = await fetch(service.url + '/v1/' + path, {method: body === undefined ? 'GET' : 'POST', headers: {Authorization: `Bearer ${token}`}, body: body === undefined ? undefined : JSON.stringify(body)})
    return {status: result.status, body: await result.json() as any}
  }
  const space = (await api('spaces', {repo: 'github.com/Team/Repo'})).body
  function device(login = 'writer') {
    const d = {service: service.url, login, githubId: login === 'writer' ? 1 : 2, boxPublicKey: Buffer.alloc(32, 1).toString('base64'), signPublicKey: Buffer.alloc(32, 2).toString('base64'), signature: '-----BEGIN SSH SIGNATURE-----\nfixture\n-----END SSH SIGNATURE-----'}
    return {id: createHash('sha256').update(JSON.stringify(['foundation-device-v1',d.service,space.space,space.repo,d.login,d.githubId,d.boxPublicKey,d.signPublicKey])).digest('hex'), ...d}
  }
  const writer = device()
  const token = (await api('token', {space: space.space, device: writer})).body.token
  const wrap = (id = writer.id, epoch = 1) => ({epoch, deviceId: id, senderId: writer.id, box: Buffer.alloc(64).toString('base64'), signature: Buffer.alloc(64).toString('base64')})
  const keys = () => api('keys', {expectedEpoch: 0, epoch: 1, wraps: [wrap()]}, token)
  const payload = (epoch = 1) => Buffer.from(JSON.stringify({v: 1, epoch, dedup: 'b'.repeat(64), nonce: Buffer.alloc(24).toString('base64'), ciphertext: Buffer.alloc(32).toString('base64')})).toString('hex')
  const append = (epoch = 1) => ({op: 'append', log: 'a'.repeat(64), idempotency_key: 'b'.repeat(64), payload_hex: payload(epoch), epoch})
  return {dir, config, api, space, device, writer, token, wrap, keys, payload, append, denied, get service() { return service }, restart: async () => { await service.close(); service = await startShareService(config) }}
}
it('checks GitHub on each issuance, binds immutable devices, and scopes read/write access', async () => {
  const f = await fixture()
  expect((await f.api('spaces', {repo: 'github.com/team/other'}, 'reader')).status).toBe(403)
  expect((await f.api('token', {space:f.space.space, device:f.device('reader')}, 'denied')).status).toBe(403)
  expect((await f.api('token', {space:f.space.space, device:f.device('reader')}, 'writer')).status).toBe(403)
  const read = await f.api('token', {space:f.space.space, device:f.device('reader')}, 'reader')
  expect(read.body.permission).toBe('read'); expect(read.body.expiresAt - Date.now()).toBeGreaterThan(3590000)
  expect((await f.api('keys', {expectedEpoch:0,epoch:1,wraps:[]}, read.body.token)).status).toBe(403)
  expect((await f.api('rpc', f.append(), read.body.token)).status).toBe(403)
  await f.keys()
  expect((await f.api('keys', {expectedEpoch:1,epoch:1,wraps:[{...f.wrap(f.device('reader').id),senderId:f.device('reader').id}]}, read.body.token)).status).toBe(200)
  expect((await f.api('keys', {expectedEpoch:1,epoch:1,recoveryPublicKey:Buffer.alloc(32).toString('base64'),wraps:[]}, read.body.token)).status).toBe(403)
  expect((await f.api('state?space=sp_wrong', undefined, read.body.token)).status).toBe(403)
  expect((await f.api('token', {space:f.space.space, device:{...f.writer,signature:'-----BEGIN SSH SIGNATURE-----changed-----END SSH SIGNATURE-----'}})).status).toBe(409)
  f.denied.add('writer')
  expect((await f.api('token', {space:f.space.space, device:f.writer})).status).toBe(403)
  expect((await f.api('state', undefined, f.token)).status).toBe(200)
})
it('preserves durable Comb receipts, rejects plaintext/malformed envelopes, and replays after restart', async () => {
  const f = await fixture(); expect((await f.keys()).status).toBe(200)
  for (const payload_hex of [Buffer.from('plaintext').toString('hex'), Buffer.from(JSON.stringify({v:1,epoch:1,plaintext:'secret'})).toString('hex')]) expect((await f.api('rpc', {...f.append(),payload_hex},f.token)).status).toBe(400)
  expect((await f.api('rpc', {...f.append(), log:'../physical'}, f.token)).status).toBe(400)
  const receipt = await f.api('rpc', f.append(), f.token)
  expect(receipt.status).toBe(200); expect(receipt.body.first).toBe('1'); expect(receipt.body.log).toBe('a'.repeat(64))
  expect((await f.api('rpc', f.append(), f.token)).body.first).toBe('1')
  const raw = await readFile(join(f.dir,'backend.json'),'utf8'); expect(raw).toContain('share-sp_'); expect(raw).not.toContain('plaintext')
  await f.restart()
  expect((await f.api('state',undefined,f.token)).status).toBe(401)
  const token = (await f.api('token',{space:f.space.space,device:f.writer})).body.token
  const read = await f.api('rpc',{op:'read',log:'a'.repeat(64),cursor:'1'},token)
  expect(read.body.events).toHaveLength(1); expect(read.body.events[0].payload_hex).toBe(f.payload())
})
it('rotates with CAS, validates sender binding and recovery, and revokes tokens and relay', async () => {
  const f = await fixture(); const reader = f.device('reader')
  const token = (await f.api('token',{space:f.space.space,device:reader},'reader')).body.token
  expect((await f.api('keys',{expectedEpoch:0,epoch:1,wraps:[{...f.wrap(),senderId:reader.id}]},f.token)).status).toBe(400)
  const recoveryPublicKey = Buffer.alloc(32,3).toString('base64')
  expect((await f.api('keys',{expectedEpoch:0,epoch:1,recoveryPublicKey,wraps:[f.wrap(),f.wrap('recovery')]},f.token)).status).toBe(200)
  expect((await f.keys()).status).toBe(409)
  const controller = new AbortController(); const relay = await fetch(f.service.url+'/v1/relay',{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
  const stream = relay.body!.getReader(); await stream.read()
  expect((await f.api('keys',{expectedEpoch:1,epoch:1,revoke:[reader.id],wraps:[]},f.token)).status).toBe(400)
  expect((await f.api('keys',{expectedEpoch:1,epoch:2,revoke:[reader.id],recoveryPublicKey,wraps:[f.wrap(f.writer.id,2),f.wrap('recovery',2)]},f.token)).status).toBe(200)
  expect((await stream.read()).done).toBe(true); controller.abort()
  expect((await f.api('state',undefined,token)).status).toBe(403)
  expect((await f.api('token',{space:f.space.space,device:reader},'reader')).status).toBe(403)
  expect((await f.api('rpc',f.append(),f.token)).status).toBe(409)
  expect((await f.api('rpc',f.append(2),f.token)).status).toBe(200)
  expect((await f.api('keys',{expectedEpoch:2,epoch:2,recoveryPublicKey:Buffer.alloc(32,4).toString('base64'),wraps:[]},f.token)).status).toBe(400)
})
it('exports explicitly metadata-only backups and refuses remote GitHub overrides', async () => {
  const f = await fixture(); await f.keys()
  await expect(startShareService({...f.config,stateDir:join(f.dir,'other'),githubApiUrl:'https://example.com'})).rejects.toThrow('loopback')
  await expect(backupShareService(f.config,join(f.dir,'backup'))).rejects.toThrow('stop service')
  await f.service.close(); await backupShareService(f.config,join(f.dir,'backup'))
  const manifest = JSON.parse(await readFile(join(f.dir,'backup','BACKUP.json'),'utf8'))
  expect(manifest.backendIncluded).toBe(false)
  const metadata = await readFile(join(f.dir,'backup','metadata.json'),'utf8')
  expect(metadata).toContain(f.writer.id); expect(metadata).not.toContain(f.token)
})
