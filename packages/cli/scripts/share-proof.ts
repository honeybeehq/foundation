import { PNG } from 'pngjs'
import { chromium } from 'playwright'
/** One-machine real CLI/daemon/Comb drill. GitHub multi-account/SSH responses are a LABELLED loopback stub. */
import { createServer } from 'node:http'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  statSync,
  readdirSync,
  existsSync,
  unlinkSync
} from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { loadavg, hostname } from 'node:os'
import assert from 'node:assert/strict'
import { loadChain } from 'foundation-engine'
import { startShareService, backupShareService } from '../src/share/service.js'
import { decrypt, opaqueName, ready } from '../src/share/crypto.js'
const root = mkdtempSync(resolve('.audit/share-run-')),
  main = resolve('packages/cli/src/main.ts'),
  binary = resolve(process.argv[2] ?? '.audit/comb-source/target/debug/comb-bridge')
const assetMode=process.argv.includes('--assets')
const localModelMode=process.argv.includes('--local-model') || assetMode
const assetFault=join(root,'asset-tamper-feed')
let proofAsset:{path:string;hash:string;bytes:Buffer}|undefined
const heldMode = process.argv.includes('--held-store'),
  holdFile = join(root, 'hold-append'),
  heldFeed = join(root, 'held-feed'),
  heldNotice = join(root, 'append-is-held'),
  releaseFile = join(root, 'release-append')
const children: ChildProcess[] = [],
  lines: string[] = []
function log(text: string) {
  const line = `${new Date().toISOString()} ${text}`
  lines.push(line)
  console.log(line)
  writeFileSync(join(root, 'transcript.log'), lines.join('\n') + '\n')
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const homes = ['alice', 'bob', 'outsider'].map((user) => {
  const home = join(root, user)
  mkdirSync(home, { mode: 0o700 })
  return home
})
const repos = homes.map((home) => {
  const repo = join(home, 'repo')
  mkdirSync(repo)
  spawnSync('git', ['init', '-q', repo])
  return repo
})
const keys = homes.map((home) => {
  const key = join(home, 'ssh')
  assert.equal(spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]).status, 0)
  return key
})
let removed = false
const ids = ['alice', 'bob', 'outsider']
const stub = createServer((req, res) => {
  const who = req.headers.authorization?.slice(7),
    index = ids.indexOf(who ?? ''),
    user = index >= 0 ? { login: who, id: index + 1 } : null
  res.setHeader('Content-Type', 'application/json')
  if (req.url?.endsWith('.keys')) {
    const i = ids.indexOf(req.url.slice(1, -5))
    res.end(i >= 0 ? readFileSync(`${keys[i]}.pub`) : '')
    return
  }
  if (req.url?.startsWith('/user/') || req.url?.startsWith('/users/')) {
    const part = req.url.split('/')[2]!,
      i = /^[0-9]+$/.test(part) ? Number(part) - 1 : ids.indexOf(part)
    res.end(JSON.stringify({ id: i + 1, login: ids[i] }))
    return
  }
  if (!user && who !== 'operator') {
    res.writeHead(401).end('{}')
    return
  }
  if (req.url === '/user') {
    res.end(JSON.stringify(user))
    return
  }
  const access = who === 'operator' || who === 'alice' || (who === 'bob' && !removed)
  if (req.url === '/repos/team/designs/contents/.foundation/share.json') {
    const committed=spawnSync('git',['show','HEAD:.foundation/share.json'],{cwd:repos[0]!,encoding:'utf8'})
    if(committed.status!==0){res.writeHead(404).end('{}');return}
    res.end(JSON.stringify({type:'file',path:'.foundation/share.json',encoding:'base64',content:Buffer.from(committed.stdout).toString('base64')}));return
  }
  if (req.url?.includes('/collaborators?')) {
    res.end(
      JSON.stringify(
        ids.slice(0, removed ? 1 : 2).map((login, i) => ({ login, id: i + 1, permissions: { push: true } }))
      )
    )
    return
  }
  if (req.url?.includes('/collaborators/')) {
    const login = req.url.split('/')[5],
      i = ids.indexOf(login ?? '')
    res.end(
      JSON.stringify({ permission: i === 0 || (i === 1 && !removed) ? 'write' : 'none', user: { login, id: i + 1 } })
    )
    return
  }
  if (req.url === '/repos/team/designs') {
    if (!access) {
      res.writeHead(404).end('{}')
      return
    }
    res.end(JSON.stringify({ private: true, permissions: { pull: true, push: true } }))
    return
  }
  res.writeHead(404).end('{}')
})
await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r))
const github = `http://127.0.0.1:${(stub.address() as { port: number }).port}`
const objects = join(root, 'objects'),
  comb = join(root, 'comb'),
  stateDir = join(root, 'service')
mkdirSync(objects)
mkdirSync(comb)
writeFileSync(
  join(comb, 'config.toml'),
  `tenant = "share-proof"\ndigest_key = "${randomBytes(32).toString('hex')}"\n[backend]\nkind = "local"\nroot = "${objects}"\n`
)
const wrapper = join(root, 'hold-comb.mjs')
if (heldMode)
  writeFileSync(
    wrapper,
    `import{spawn}from'node:child_process';import{createInterface}from'node:readline';import{readFileSync,existsSync,writeFileSync}from'node:fs';const child=spawn(${JSON.stringify(binary)},process.argv.slice(2),{stdio:'pipe'});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);const held=[];const timer=setInterval(()=>{if(existsSync(${JSON.stringify(releaseFile)})||!existsSync(${JSON.stringify(holdFile)}))for(const line of held.splice(0))child.stdin.write(line+String.fromCharCode(10))},10);const input=createInterface({input:process.stdin});input.on('line',line=>{const request=JSON.parse(line);if(request.op==='append'&&existsSync(${JSON.stringify(holdFile)})&&request.log===readFileSync(${JSON.stringify(heldFeed)},'utf8')){held.push(line);writeFileSync(${JSON.stringify(heldNotice)},'held')}else child.stdin.write(line+String.fromCharCode(10))});input.on('close',()=>{clearInterval(timer);child.stdin.end()});`
  )
if(assetMode)writeFileSync(wrapper,`import{spawn}from'node:child_process';import{createInterface}from'node:readline';import{readFileSync,existsSync}from'node:fs';const child=spawn(${JSON.stringify(binary)},process.argv.slice(2),{stdio:'pipe'});const requests=new Map();createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line);requests.set(request.id,request);child.stdin.write(line+String.fromCharCode(10))}).on('close',()=>child.stdin.end());createInterface({input:child.stdout}).on('line',line=>{const frame=JSON.parse(line),request=requests.get(frame.id);requests.delete(frame.id);if(existsSync(${JSON.stringify(assetFault)})&&request?.op==='read'&&request.log===readFileSync(${JSON.stringify(assetFault)},'utf8'))for(const event of frame.events??[]){const r=JSON.parse(Buffer.from(event.payload_hex,'hex'));const b=Buffer.from(r.ciphertext,'base64');b[0]^=1;r.ciphertext=b.toString('base64');event.payload_hex=Buffer.from(JSON.stringify(r)).toString('hex')}process.stdout.write(JSON.stringify(frame)+String.fromCharCode(10))});child.stderr.pipe(process.stderr);`)
const serviceConfig = {
  stateDir,
  comb: heldMode || assetMode
    ? { binary: process.execPath, args: [wrapper, '--dir', comb, '--lease', '3'] }
    : { binary, args: ['--dir', comb, '--lease', '3'] },
  githubApiUrl: github,
  githubPermissionToken: 'operator',
  backupLocalStore: objects
}
let service = await startShareService(serviceConfig)
function cli(index: number, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', main, ...args], {
      env: {
        ...process.env,
        HOME: homes[index],
        FOUNDATION_SHARE_STATE_DIR: join(homes[index]!,".foundation/share"),
        FOUNDATION_SHARE_TEST_GITHUB: github,
        FOUNDATION_REPLICA_STORE: join(homes[index]!, 'replicas'),
        FOUNDATION_NODE_ID: ids[index],
        FOUNDATION_ORIGIN_NODE: ids[index]
      },
      stdio: 'pipe'
    })
    children.push(child)
    let out = '',
      err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.stdin.end(ids[index])
    child.on('exit', (code) => resolve({ code: code ?? 1, out, err }))
  })
}
async function ok(index: number, ...args: string[]) {
  const result = await cli(index, ...args)
  assert.equal(result.code, 0, `${args}: ${result.err}`)
  return result.out
}
function daemon(index: number) {
  const child = spawn(process.execPath, ['--import', 'tsx', main, 'sync', 'serve'], {
    env: {
      ...process.env,
      HOME: homes[index],
      FOUNDATION_SHARE_STATE_DIR: join(homes[index]!,".foundation/share"),
      FOUNDATION_SHARE_TEST_GITHUB: github,
      FOUNDATION_REPLICA_STORE: join(homes[index]!, 'replicas'),
      FOUNDATION_NODE_ID: ids[index],
        FOUNDATION_ORIGIN_NODE: ids[index]
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  children.push(child)
  child.stderr!.on('data', (d) => log(`daemon ${ids[index]}: ${String(d).trim()}`))
  return child
}
function activityFollow(index:number,workspace:string,cursor?:string) {
  const records:any[]=[]
  const child=spawn(process.execPath,['--import','tsx',main,'sync','activity','--workspace',workspace,'--follow','--json',...(cursor?['--cursor',cursor]:[])],{env:{...process.env,HOME:homes[index],FOUNDATION_SHARE_STATE_DIR:join(homes[index]!,".foundation/share"),FOUNDATION_SHARE_TEST_GITHUB:github,FOUNDATION_REPLICA_STORE:join(homes[index]!,'replicas'),FOUNDATION_NODE_ID:ids[index],FOUNDATION_ORIGIN_NODE:ids[index]},stdio:['ignore','pipe','pipe']})
  children.push(child);let buffer=''
  child.stdout!.on('data',chunk=>{buffer+=String(chunk);let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(line)records.push(JSON.parse(line))}})
  child.stderr!.on('data',chunk=>log(`activity ${ids[index]}: ${String(chunk).trim()}`))
  return {child,records}
}
async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 20000) {
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > timeout) throw new Error(`timeout ${label}`)
    await wait(20)
  }
  log(`${label}: ${Date.now() - start}ms`)
}
const files = repos.map((repo) => join(repo, 'board.fdn.html'))
function chain(i: number) {
  return loadChain(readFileSync(`${files[i]}.chain`))
}
function text(i: number, id: string) {
  return chain(i)
    .doc()
    .body.find((n) => n.id === id)?.text
}
function vault(i: number) {
  return JSON.parse(readFileSync(join(homes[i]!, '.foundation/share/keys.json'), 'utf8')).sessions as Record<
    string,
    any
  >
}
try {
  log(
    'LABELLED STUB: GitHub identities, repo membership and SSH public keys served by loopback fixture; actual CLI/crypto/HTTP/Comb/disk are real'
  )
  const prepared = await ok(
    0,
    'share',
    'init',
    '--service',
    service.url,
    '--repo',
    'github.com/team/designs',
    '--repo-root',
    repos[0]!,
    '--ssh-key',
    keys[0]!,
    '--token-stdin'
  )
  assert.match(prepared, /Commit it to the repository default branch/)
  assert.equal(existsSync(join(stateDir,'metadata.json')),false)
  log('PREPARE: no server space or token before descriptor commit')
  const uncommitted = await cli(0,'share','init','--repo-root',repos[0]!,'--ssh-key',keys[0]!,'--token-stdin')
  assert.equal(uncommitted.code,1);assert.match(uncommitted.err,/Commit .foundation\/share.json/)
  log('UNCOMMITTED DESCRIPTOR REFUSED: init cannot enable sharing')
  assert.equal(spawnSync('git',['add','.foundation/share.json'],{cwd:repos[0]!}).status,0)
  assert.equal(spawnSync('git',['-c','user.name=Share Proof','-c','user.email=proof@example.invalid','commit','-qm','Enable encrypted sharing'],{cwd:repos[0]!}).status,0)
  const init=await ok(0,'share','init','--repo-root',repos[0]!,'--ssh-key',keys[0]!,'--token-stdin')
  assert.match(init, /Recovery code saved privately/)
  log('COMMITTED DESCRIPTOR ACCEPTED: default branch stub reads actual git HEAD, not working tree')
  log('init created secret-free share.json; recovery code withheld from transcript')
  for (let i = 1; i < 3; i++) {
    mkdirSync(join(repos[i]!, '.foundation'))
    copyFileSync(join(repos[0]!, '.foundation/share.json'), join(repos[i]!, '.foundation/share.json'))
  }
  const config = JSON.parse(readFileSync(join(repos[0]!, '.foundation/share.json'), 'utf8')),
    space = config.space
  let a = daemon(0)
  const second = await ok(1, 'share', 'login', '--repo-root', repos[1]!, '--ssh-key', keys[1]!, '--token-stdin')
  log(`second member login: ${second.trim()}`)
  let b = daemon(1)
  await until(
    () => Object.values(vault(1)).some((s: any) => s.keys.length > 0),
    'automatic signed-device key handover with no designs open'
  )
  await ok(0, 'new', files[0]!)
  copyFileSync(files[0]!, files[1]!)
  copyFileSync(`${files[0]}.chain`, `${files[1]}.chain`)
  await ok(0, 'sync', 'close', files[0]!)
  await ok(0, 'sync', 'open', files[0]!, '--repo-root', repos[0]!, '--workspace', 'machine-A', '--product', 'local-A')
  await ok(1, 'sync', 'open', files[1]!, '--repo-root', repos[1]!, '--workspace', 'machine-B', '--product', 'local-B')
  await until(async () => {
    const rows = JSON.parse(await ok(0, 'sync', 'status', '--json'))
    return rows[0]?.status === 'shared'
  }, 'genesis durably acknowledged')
  let activity:ReturnType<typeof activityFollow>|undefined
  let outageHash:string|undefined,materialized:{docId:string;headHash:string}|undefined
  if(localModelMode){activity=activityFollow(1,'machine-B');await until(()=>activity!.records.some(r=>r.type==='ready'),'activity baseline caught-up marker');assert.ok(activity.records.filter(r=>r.entry).every(r=>r.delivery==='baseline'))}
  for (const [from, to, id, word] of [
    [0, 1, 'n1', 'SECRET-ALICE-TEXT'],
    [1, 0, 'n2', 'SECRET-BOB-TEXT']
  ] as const) {
    await ok(
      from,
      'edit',
      files[from]!,
      '--ops',
      JSON.stringify([{ op: 'set-text', id, text: word }]),
      '--author',
      ids[from]!
    )
    const saved = statSync(`${files[from]}.chain`).mtimeMs
    await until(() => text(to, id) === word, `${ids[from]} edit visible on other member`)
    const elapsed = Date.now() - saved
    log(`save-to-remote visibility ${ids[from]}: ${elapsed}ms`)
    assert.ok(elapsed < 1000, `sub-second visibility ${elapsed}`)
  }
  if(assetMode) {
    const width=1280,height=1024,data=Buffer.alloc(width*height*4)
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const n=(y*width+x)*4;data[n]=Math.floor(x*255/width);data[n+1]=Math.floor(y*255/height);data[n+2]=(x+y)%256;data[n+3]=255}
    const bytes=PNG.sync.write({width,height,data},{deflateLevel:0,filterType:0}),hash=createHash('sha256').update(bytes).digest('hex'),path=`.foundation/assets/${hash}.png`
    assert.ok(bytes.length>=5*1024*1024);proofAsset={path,hash,bytes}
    mkdirSync(join(repos[0]!,'.foundation/assets'),{recursive:true});writeFileSync(join(repos[0]!,path),bytes)
    await ok(0,'edit',files[0]!,'--ops',JSON.stringify([{op:'insert-node',parent:null,index:2,node:{id:'asset-image',tag:'img',attrs:{src:path,alt:'Encrypted shared five megabyte image','data-asset-proof':'true'},style:{width:'640px',height:'512px'},styleStates:{},children:[]}}]),'--author','alice')
    await ok(0,'edit',files[0]!,'--ops',JSON.stringify([{op:'set-text',id:'n1',text:'A1-DURING-IMAGE'}]),'--author','alice')
    await until(()=>text(1,'n1')==='A1-DURING-IMAGE','text changes sync while image is pending',3000)
    await until(()=>chain(1).doc().body.some(n=>n.id==='asset-image')&&existsSync(join(repos[1]!,path)),'5MB image fetched and verified in background',120000)
    assert.deepEqual(readFileSync(join(repos[1]!,path)),bytes)
    const browser=await chromium.launch({headless:true,args:['--no-sandbox']})
    try{const page=await browser.newPage({viewport:{width:1000,height:900}});await page.goto('file://'+files[1]);await page.waitForFunction(()=>{const image=document.querySelector('img[data-asset-proof]') as HTMLImageElement|null;return image?.complete&&image.naturalWidth===1280});await page.screenshot({path:join(root,'received-image.png'),fullPage:true});log('IMAGE RENDER: second HOME actual browser img naturalWidth1280/naturalHeight1024; screenshot '+join(root,'received-image.png'))}finally{await browser.close()}
    log(`ASSET: ${bytes.length}byte PNG transferred byte-exact; pending reference remains a consistent chain`)
    await ok(0,'edit',files[0]!,'--ops',JSON.stringify([{op:'set-text',id:'n1',text:'A1-AFTER-IMAGE'}]),'--author','alice');await until(()=>text(1,'n1')==='A1-AFTER-IMAGE','ordinary edit on image design still relays promptly',1000)
    const state=vault(1)[space],current=state.keys.at(-1),opaque=opaqueName(`foundation-share-asset-v1:${hash}.png:0`,current.feedKey)
    const counts:number[]=[]
    const {CombBridge}=await import('../src/sync/bridge.js');const inspector=new CombBridge(binary,['--dir',comb,'--lease','3']);try{await inspector.hello();for(let i=0;i<Math.ceil(bytes.length/(128*1024));i++){const name=opaqueName(`foundation-share-asset-v1:${hash}.png:${i}`,current.feedKey);const head=await inspector.request('head',{log:`share-${space}-${name}`});counts.push(Number(head.cursor)-1)}}finally{await inspector.finish()}
    assert.ok(counts.every(n=>n===1));writeFileSync(join(root,'asset-feed-counts.json'),JSON.stringify({workload:'shared-image-assets',seriesId:'metal3-image-5mb-v1',results:[{metric:'maxChunkFeedEvents',samples:counts,invariantHolds:true}]}));log(`ASSET BOUNDS: ${counts.length} opaque chunk feeds; max durable events perfeed ${Math.max(...counts)}`)
    writeFileSync(assetFault,`share-${space}-${opaque}`)
    const dir=join(repos[1]!,'tamper');mkdirSync(dir)
    const script=join(root,'fetch-tampered.ts')
    writeFileSync(script,`import{readFileSync}from'node:fs';import{loadChain}from${JSON.stringify(resolve('packages/engine/src/index.ts'))};import{AssetSharing}from${JSON.stringify(resolve('packages/cli/src/share/assets.ts'))};const chain=loadChain(readFileSync(${JSON.stringify(files[1]+'.chain')}));await new AssetSharing({binary:'',args:[],share:${JSON.stringify(config)}},${JSON.stringify(join(dir,'board.fdn.html'))},${JSON.stringify(repos[1])}).receive(chain);`)
    const result=await new Promise<{code:number;err:string}>(resolve=>{const child=spawn(process.execPath,['--import','tsx',script],{env:{...process.env,HOME:homes[1],FOUNDATION_SHARE_STATE_DIR:join(homes[1]!,'.foundation/share'),FOUNDATION_SHARE_TEST_GITHUB:github,FOUNDATION_REPLICA_STORE:join(homes[1]!,'replicas')},stdio:['ignore','ignore','pipe']});let err='';child.stderr.on('data',v=>err+=v);child.on('exit',code=>resolve({code:code??1,err}))})
    unlinkSync(assetFault);assert.notEqual(result.code,0);assert.match(result.err,/signature|decrypt|authentication/i);assert.equal(existsSync(join(dir,path)),false);assert.deepEqual(readdirSync(join(dir,'.foundation/assets')),[])
    log('ASSET TAMPER REFUSED: real Comb read ciphertext bit-flip rejected; no installed file or partial temp')
    const invalids:[string,Buffer|null,string?][]=[['missing',null,'f'.repeat(64)],['oversize',Buffer.alloc(20*1024*1024+1,7)],['hash-mismatch',Buffer.from('not the named content'),'e'.repeat(64)],['unsupported',Buffer.from('not an image signature')]]
    for(const [name,content,forced]of invalids){
      const badHash=forced??createHash('sha256').update(content!).digest('hex'),badPath=`.foundation/assets/${badHash}.png`
      if(content)writeFileSync(join(repos[0]!,badPath),content)
      await ok(0,'edit',files[0]!,'--ops',JSON.stringify([{op:'set-attr',id:'asset-image',key:'src',value:badPath},{op:'set-text',id:'n1',text:`A1-${name}`}]),'--author','alice')
      await until(()=>text(1,'n1')===`A1-${name}`,`${name} image does not block forward text sync`,5000)
      await ok(1,'edit',files[1]!,'--ops',JSON.stringify([{op:'set-text',id:'n2',text:`reply-${name}`}]),'--author','bob')
      await until(()=>text(0,'n2')===`reply-${name}`,`${name} image does not block reverse text sync`,5000)
      await until(async()=>JSON.parse(await ok(1,'sync','status','--json')).some((r:any)=>r.assets?.some((a:any)=>a.path===badPath&&['pending','error'].includes(a.state))),`${name} image status is visible`,5000)
      assert.equal(existsSync(join(repos[1]!,badPath)),false)
      log(`ASSET ISOLATION: ${name} image pending/error visible; both directions still sync; no invalid local file`)
    }
    await ok(0,'edit',files[0]!,'--ops',JSON.stringify([{op:'set-attr',id:'asset-image',key:'src',value:path},{op:'set-text',id:'n1',text:'see .foundation/assets/logo.png'}]),'--author','alice')
    await until(()=>text(1,'n1')==='see .foundation/assets/logo.png','asset-like prose does not block sync',5000)
    log('ASSET PROSE: non-contract names in text ignored; original verified image restored')

  }
  if(localModelMode) {
    await until(()=>activity!.records.some(r=>r.entry?.author==='alice'&&r.delivery==='live'),'signed ephemeral hint yields live imported activity')
    const event=activity!.records.find(r=>r.entry?.author==='alice'&&r.delivery==='live')
    assert.equal(event.originNode.id,chain(0).log().find(e=>e.author==='alice')!.originNode);assert.equal(event.originAssurance,'writer-stated');assert.equal(event.signatureVerified,true)
    assert.equal(event.document.ownerNodeId,'bob');assert.ok(event.entry.nodeIds.includes('n1'))
    log(`ACTIVITY: signed writer-stated ${event.originNode.id} origin retained on bob-owned replica; touched n1; no owner substitution`)
    const token=activity!.records.filter(r=>r.entry).at(-1).cursor
    activity!.child.kill('SIGTERM')
    const resumed=activityFollow(1,'machine-B',token)
    await until(()=>resumed.records.some(r=>r.type==='ready'),'activity cursor resume caught-up marker')
    assert.ok(resumed.records.filter(r=>r.entry).every(r=>r.delivery==='baseline'));resumed.child.kill('SIGTERM')
    activity=activityFollow(1,'machine-B',resumed.records.find(r=>r.type==='ready').cursor)
    await until(()=>activity!.records.some(r=>r.type==='ready'),'persistent activity observer ready for outage')
    const remoteOnly=join(repos[0]!,'remote-only.fdn.html')
    await ok(0,'new',remoteOnly)
    if(assetMode)await ok(0,'edit',remoteOnly,'--ops',JSON.stringify([{op:'insert-node',parent:null,index:2,node:{id:'asset-image',tag:'img',attrs:{src:proofAsset!.path,alt:'Materialized shared image'},style:{width:'640px',height:'512px'},styleStates:{},children:[]}}]),'--author','alice')
    await ok(0,'sync','close',remoteOnly)
    await ok(0,'sync','open',remoteOnly,'--repo-root',repos[0]!,'--workspace','machine-A','--product','local-A')
    const remoteDocId=loadChain(readFileSync(remoteOnly+'.chain')).docId()
    const snapshot=async()=>JSON.parse(await ok(1,'sync','catalogue','--workspace','machine-A','--json'))
    await until(async()=>(await snapshot()).records.some((r:any)=>r.docId===remoteDocId),'remote-only catalogue persisted on second HOME')
    const index=await snapshot(),record=index.records.find((r:any)=>r.docId===remoteDocId)
    assert.equal(index.version,1);assert.equal(index.localReplicas.length,0)
    log(`CATALOGUE: cached remote-only row ${record.docId}; origin ${record.originNode.id}; revision ${index.revision}`)
    const key='S7-open-'+record.docId
    if(assetMode){mkdirSync(join(repos[1]!,'materialized'),{recursive:true})}
    const accepted=JSON.parse(await ok(1,'sync','materialize',record.docId,assetMode?'materialized/remote-open.fdn.html':'remote-open.fdn.html','--repo-root',repos[1]!,'--workspace','machine-A','--product','local-A','--source-replica',record.replicaId,'--expected-head',record.headHash,'--request-key',key,'--json','--accept'))
    assert.equal(accepted.state,'accepted')
    let settled:any
    await until(async()=>{settled=JSON.parse(await ok(1,'sync','materialize-status',key,'--json'));if(settled.state==='refused')throw new Error(JSON.stringify(settled));return settled.state==='ready'},'encrypted materialization accepted then ready')
    assert.equal(settled.path,join(repos[1]!,assetMode?'materialized/remote-open.fdn.html':'remote-open.fdn.html'))
    if(assetMode){assert.deepEqual(readFileSync(join(dirname(settled.path),proofAsset!.path)),proofAsset!.bytes);log('ASSET MATERIALIZE: remote-only encrypted history plus missing5MB image ready in a new directory')}
    ;assert.equal(loadChain(readFileSync(settled.path+'.chain')).docId(),record.docId);assert.notEqual(settled.fromCache,true)
    materialized={docId:record.docId,headHash:settled.headHash}
    log('MATERIALIZE: asynchronous accepted/ready; actual encrypted network history (no local candidate); confined path; original document identity')
    const verified=JSON.parse(await ok(1,'sync','verify',settled.path,'--doc-id',record.docId,'--expected-head',record.headHash,'--json'))
    assert.equal(verified.state,'verified')
    const wrong=await cli(1,'sync','verify',settled.path,'--doc-id','foreign','--json')
    assert.equal(wrong.code,1);assert.equal(JSON.parse(wrong.out).code,'identity-mismatch')
    const conflict=join(repos[1]!,'foreign.fdn.html')
    await ok(1,'new',conflict)
    await ok(1,'sync','close',conflict)
    const original=readFileSync(conflict),originalChain=readFileSync(conflict+'.chain')
    const conflictKey='S7-conflict-'+record.docId
    await ok(1,'sync','materialize',record.docId,'foreign.fdn.html','--repo-root',repos[1]!,'--workspace','machine-A','--product','local-A','--expected-head',record.headHash,'--request-key',conflictKey,'--accept','--json')
    let refusal:any
    await until(async()=>{refusal=JSON.parse(await ok(1,'sync','materialize-status',conflictKey,'--json'));return refusal.state!=='pending'},'foreign target refusal settles')
    assert.equal(refusal.state,'refused');assert.equal(refusal.code,'path-conflict')
    assert.deepEqual(readFileSync(conflict),original);assert.deepEqual(readFileSync(conflict+'.chain'),originalChain)
    log('REFUSAL: wrong docId verification and foreign target refused; both foreign files remain exact')
    const cacheDir=join(homes[1]!,'replicas/read-model/catalogues')
    let cacheMtime=0,stableAt=Date.now()
    await until(()=>{const name=readdirSync(cacheDir).find(f=>f.endsWith('.json'))!;const mtime=statSync(join(cacheDir,name)).mtimeMs;if(mtime!==cacheMtime){cacheMtime=mtime;stableAt=Date.now()};return Date.now()-stableAt>2200},'idle catalogue data checkpoint stays unchanged across contact polls',15000)
    log('IDLE: follower contact remains fresh without rewriting the durable catalogue data checkpoint')
  }
  if (heldMode) {
    await until(
      async () =>
        [0, 1].every((i) => {
          try {
            const files = readdirSync(join(homes[i]!, 'replicas')).filter((f) => f.endsWith('.json'))
            return files.some((f) => {
              const r = JSON.parse(readFileSync(join(homes[i]!, 'replicas', f), 'utf8'))
              return Array.isArray(r.published) && r.pending === 0
            })
          } catch {
            return false
          }
        }),
      'both replicas caught up before held store'
    )
    const heldKey = vault(0)[space].keys.at(-1),
      logName = opaqueName(JSON.stringify(['foundation-share-document-v1', chain(0).docId()]), heldKey.feedKey)
    writeFileSync(heldFeed, `share-${space}-${logName}`)
    writeFileSync(holdFile, 'hold')
    const cursorBefore = JSON.parse(await ok(1, 'sync', 'status', '--json'))[0].cursor
    const samples: number[] = []
    let invariant = false,
      failure: string | null = null
    const receiptPath = process.env.FOUNDATION_HELD_RECEIPT ?? join(root, 'held-store.json')
    try {
      for (let i = 0; i < 5; i++) {
        const marker = `HELD-STORE-SAVE-${i}`
        await ok(
          0,
          'edit',
          files[0]!,
          '--ops',
          JSON.stringify([{ op: 'set-text', id: 'n1', text: marker }]),
          '--author',
          'alice'
        )
        const saved = statSync(`${files[0]}.chain`).mtimeMs
        await until(() => text(1, 'n1') === marker, `held save ${i} imports before release`, 2000)
        const elapsed = Date.now() - saved + 2
        samples.push(elapsed)
        log(`HELD-STORE local save visibility ${i}: ${elapsed}ms`)
        assert.ok(elapsed < 1000, `held save ${i} exceeds local1000ms gate: ${elapsed}`)
        if (i === 0) await until(() => existsSync(heldNotice), 'actual Comb append deliberately held')
      }
      const heldStatus = JSON.parse(await ok(1, 'sync', 'status', '--json'))[0]
      assert.equal(heldStatus.cursor, cursorBefore)
      assert.notEqual(heldStatus.status, 'shared')
      invariant = true
      log('HELD-STORE: all5 saves visible, durable cursor unchanged before release')
    } catch (error) {
      failure = String(error)
      throw error
    } finally {
      writeFileSync(
        receiptPath,
        JSON.stringify(
          {
            workload: 'share-held-store',
            seriesId: 'metal3-local-held-v1',
            commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
            machine: hostname(),
            runtime: process.version,
            buildMode: 'source-tsx',
            load: loadavg(),
            independentHints: process.env.FOUNDATION_SHARE_HINTS !== '0',
            relay: process.env.FOUNDATION_SHARE_RELAY !== '0',
            driverSha256: createHash('sha256')
              .update(readFileSync(new URL(import.meta.url)))
              .digest('hex'),
            failure,
            results: [{ metric: 'heldSaveVisibilityMax', samples, invariantHolds: invariant }]
          },
          null,
          2
        ) + '\n'
      )
      if (existsSync(holdFile)) unlinkSync(holdFile)
      writeFileSync(releaseFile, 'release')
    }
    await until(
      async () => {
        const a = JSON.parse(await ok(0, 'sync', 'status', '--json'))[0],
          b = JSON.parse(await ok(1, 'sync', 'status', '--json'))[0]
        return a.status === 'shared' && b.status === 'shared'
      },
      'held-store durable drain after release',
      30000
    )
  }
  const denied = await cli(2, 'share', 'login', '--repo-root', repos[2]!, '--ssh-key', keys[2]!, '--token-stdin')
  assert.equal(denied.code, 1)
  assert.match(denied.err, /no access/)
  log(`NO ACCESS REFUSED: ${denied.err.trim()}`)
  const old = structuredClone(vault(1)[space].keys)
  const metadataBefore = JSON.parse(readFileSync(join(stateDir, 'metadata.json'), 'utf8'))
  assert.ok(!JSON.stringify(metadataBefore).includes(old[0].key))
  // Remove membership, then run a fresh client membership poll (same production path; daemon poll interval is 120s).
  removed = true
  await ok(0, 'share', 'grant', '--repo-root', repos[0]!)
  await until(
    () => JSON.parse(readFileSync(join(stateDir, 'metadata.json'), 'utf8')).spaces[0].epoch === 2,
    'removal causes epoch rotation'
  )
  const bobId = vault(1)[space].device.device.id
  assert.ok(JSON.parse(readFileSync(join(stateDir, 'metadata.json'), 'utf8')).spaces[0].revoked.includes(bobId))
  log('removed device token revoked and relay disconnected')
  await ok(
    0,
    'edit',
    files[0]!,
    '--ops',
    JSON.stringify([{ op: 'set-text', id: 'n1', text: 'SECRET-AFTER-REMOVAL' }]),
    '--author',
    'alice'
  )
  await until(
    async () => JSON.parse(await ok(0, 'sync', 'status', '--json'))[0]?.status === 'shared',
    'new epoch change durably acknowledged'
  )
  const current = vault(0)[space],
    logical = (await import('../src/sync/daemon.js')).combLog({
      docId: chain(0).docId(),
      file: files[0]!,
      workspace: 'default',
      product: 'default'
    }),
    logName = opaqueName(JSON.stringify(['foundation-share-document-v1', chain(0).docId()]), current.keys[0].feedKey)
  const rawResponse = await fetch(`${service.url}/v1/rpc`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${current.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ space, op: 'read', log: logName, cursor: '1', max_events: 128, max_bytes: 491520 })
  })
  assert.equal(rawResponse.status, 200)
  const raw = (await rawResponse.json()) as { events: { payload_hex: string }[] }
  const latest = raw.events.at(-1)!.payload_hex
  await ready
  assert.throws(() => decrypt(space, logName, latest, old))
  assert.ok(decrypt(space, logName, latest, current.keys))
  assert.throws(() => decrypt(space, logName, latest, []))
  log('RAW STORE CIPHERTEXT: removed member old keys and nonmember empty keys cannot decrypt latest event')
  const refused = await fetch(`${service.url}/v1/state?space=${space}`, {
    headers: { Authorization: `Bearer ${vault(1)[space].token}` }
  })
  assert.equal(refused.status, 403)
  log(`REMOVED TOKEN REFUSED: HTTP ${refused.status}`)
  const grep = spawnSync(
    'rg',
    ['-a', '-n', `SECRET-ALICE-TEXT|SECRET-BOB-TEXT|SECRET-AFTER-REMOVAL|${chain(0).docId()}`, objects, stateDir],
    { encoding: 'utf8' }
  )
  assert.equal(grep.status, 1, grep.stdout)
  log(`RAW-STORE GREP: exit ${grep.status}, no plaintext matches in Comb objects or service metadata`)
  if(assetMode){const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);for(const file of [...walk(objects),...walk(stateDir)]){const raw=readFileSync(file);assert.equal(raw.includes(proofAsset!.bytes.subarray(64,192)),false);assert.equal(raw.includes(Buffer.from(proofAsset!.hash)),false)}log('ASSET RAW-STORE GREP: zero matches for128 exact PNG bytes or plaintext content SHA in all Comb/service files')}
  assert.notEqual(text(1, 'n1'), 'SECRET-AFTER-REMOVAL')
  const altered = JSON.parse(Buffer.from(latest, 'hex').toString())
  altered.ciphertext = altered.ciphertext.slice(0, -4) + 'AAAA'
  assert.throws(() => decrypt(space, logName, Buffer.from(JSON.stringify(altered)).toString('hex'), current.keys))
  log('TAMPER REFUSED: changed encrypted record fails authentication')
  // A malicious service proxy changes only state; real status command must stop before any append.
  let attack = 'rollback'
  const proxy = createServer(async (req, res) => {
    const response = await fetch(service.url + (req.url ?? '/'), {
      headers: { Authorization: req.headers.authorization ?? '' }
    })
    const state = (await response.json()) as any
    if (req.url?.startsWith('/v1/state')) {
      if (attack === 'rollback') state.epoch = 1
      else state.recoveryPublicKey = Buffer.alloc(32, 9).toString('base64')
    }
    res.writeHead(response.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(state))
  })
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r))
  const descriptor = join(repos[0]!, '.foundation/share.json'),
    original = readFileSync(descriptor)
  try {
    const changed = { ...config, service: `http://127.0.0.1:${(proxy.address() as { port: number }).port}` }
    writeFileSync(descriptor, JSON.stringify(changed))
    const rollback = await cli(0, 'share', 'status', '--repo-root', repos[0]!, '--json')
    assert.match(rollback.out, /rolled back/)
    log(`ROLLBACK REFUSED: ${rollback.out.trim()}`)
    attack = 'recovery'
    const recovery = await cli(0, 'share', 'status', '--repo-root', repos[0]!, '--json')
    assert.match(recovery.out, /recovery key differs/)
    log(`RECOVERY SUBSTITUTION REFUSED: ${recovery.out.trim()}`)
  } finally {
    writeFileSync(descriptor, original)
    await new Promise<void>((r) => proxy.close(() => r()))
  }

  // Refused rotation must stay required on the next attempt; it must never fall through to the old key.
  a.kill('SIGTERM')
  if (a.exitCode === null) await new Promise<void>((r) => a.once('exit', () => r()))
  const homeBefore = process.env.HOME,
    githubBefore = process.env.FOUNDATION_SHARE_TEST_GITHUB,
    fetchBefore = globalThis.fetch
  process.env.HOME = homes[0]
  process.env.FOUNDATION_SHARE_TEST_GITHUB = github
  let refusedRotations = 0
  globalThis.fetch = async (input, init) => {
    if (String(input) === service.url + '/v1/keys') {
      refusedRotations++
      return new Response('{"error":"rotation deliberately refused"}', { status: 503 })
    }
    return fetchBefore(input, init)
  }
  try {
    const { maintainKeys } = await import('../src/share/client.js')
    await assert.rejects(() => maintainKeys(config, ['f'.repeat(64)]), /503/)
    assert.equal(vault(0)[space].rotationRequired, true)
    await assert.rejects(() => maintainKeys(config), /503/)
    assert.equal(refusedRotations, 2)
    assert.equal(vault(0)[space].rotationRequired, true)
    log('REFUSED ROTATION: requirement persisted across retries; old-key sending stays paused')
    globalThis.fetch = fetchBefore
    await maintainKeys(config)
    assert.equal(vault(0)[space].rotationRequired, false)
  } finally {
    globalThis.fetch = fetchBefore
    if (homeBefore === undefined) delete process.env.HOME
    else process.env.HOME = homeBefore
    if (githubBefore === undefined) delete process.env.FOUNDATION_SHARE_TEST_GITHUB
    else process.env.FOUNDATION_SHARE_TEST_GITHUB = githubBefore
  }
  a = daemon(0)
  // Outage: stop service, local edit remains available; restart same store/port, daemon renews invalid token.
  const port = (service.server.address() as { port: number }).port
  await service.close()
  log('OUTAGE: service stopped')
  if(localModelMode){
    await until(async()=>JSON.parse(await ok(1,'sync','catalogue','--workspace','machine-A','--json')).freshness.state==='stale','catalogue marks service outage stale')
    const cached=JSON.parse(await ok(1,'sync','catalogue','--workspace','machine-A','--json'))
    assert.ok(cached.records.length>0);log('OFFLINE CACHE: cached remote rows retained; read succeeds with service stopped, no scan/network wait')
    const offline=JSON.parse(await ok(1,'sync','materialize',materialized!.docId,'offline-copy.fdn.html','--repo-root',repos[1]!,'--workspace','machine-A','--product','local-A','--expected-head',materialized!.headHash,'--json'))
    assert.equal(offline.state,'ready');assert.equal(offline.fromCache,true)
    log('OFFLINE MATERIALIZE: complete local history opens another confined replica with service stopped')
  }
  await ok(
    0,
    'edit',
    files[0]!,
    '--ops',
    JSON.stringify([{ op: 'set-text', id: 'n2', text: 'LOCAL-DURING-OUTAGE' }]),
    '--author',
    'alice'
  )
  assert.equal(text(0, 'n2'), 'LOCAL-DURING-OUTAGE')
  outageHash=chain(0).head().hash
  log('local edit saved during outage')
  service = await startShareService({ ...serviceConfig, port })
  await until(
    async () => JSON.parse(await ok(0, 'sync', 'status', '--json'))[0]?.status === 'shared',
    'outbox recovered after service restart',
    40000
  )
  // A still-authorized user can re-attest after SSH rotation even when the old device id was revoked.
  removed = false
  const replacementSSH = join(homes[1]!, 'replacement-ssh')
  assert.equal(spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', replacementSSH]).status, 0)
  keys[1] = replacementSSH
  await ok(1, 'share', 'login', '--repo-root', repos[1]!, '--ssh-key', replacementSSH, '--reattest', '--token-stdin')
  assert.notEqual(vault(1)[space].device.device.id, bobId)
  await until(
    () => vault(1)[space].keys.some((k: any) => k.epoch >= 3),
    're-attested replacement device receives current key'
  )
  log('RE-ATTEST: renewed SSH binding and replaced revoked device keys; current access checked again')
  if(localModelMode){
    await until(()=>activity!.records.some(r=>r.entry?.hash===outageHash),'outage history arrives as baseline imported fact')
    const replay=activity!.records.filter(r=>r.entry?.hash===outageHash)
    assert.equal(replay.length,1);assert.equal(replay[0].delivery,'baseline');assert.equal(replay[0].source,'import')
    log('REPLAY: delayed outage edit is exactly one imported baseline fact, never a live lease')
    const history=JSON.parse(await ok(1,'chain',files[1]!,'log','--json'))
    const entry=history.entries.find((e:any)=>e.hash===outageHash)
    assert(entry,'outage change in durable history')
    assert.equal(entry.originNode,chain(0).log().find(e=>e.hash===outageHash)!.originNode)
    assert.equal(entry.originAssurance,'writer-stated')
    const own=JSON.parse(await ok(0,'chain',files[0]!,'log','--json')).entries.find((e:any)=>e.hash===outageHash)
    assert.equal(own.originAssurance,'local')
    log(`HISTORY: outage edit ${entry.hash.slice(0,12)} originNode=${entry.originNode} originAssurance=${entry.originAssurance}; author's own history assurance=${own.originAssurance}`)

    const prior=JSON.parse(readFileSync(join(homes[1]!,'replicas/read-model/activity-index.json'),'utf8'))
    b.kill('SIGTERM');await until(()=>b.exitCode!==null,'daemon stops before journal restart')
    b=daemon(1);await wait(1200)
    const after=JSON.parse(readFileSync(join(homes[1]!,'replicas/read-model/activity-index.json'),'utf8'))
    assert.equal(after.id,prior.id)
    const facts=(await ok(1,'sync','activity','--workspace','machine-B','--json')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))
    assert.equal(facts.filter((r:any)=>r.entry.hash===outageHash).length,1)
    log('RESTART: durable activity cursor and cross-copy hash dedup retained')
    activity!.child.kill('SIGTERM')
  }
  const validToken=vault(0)[space].token
  const relayCheck=await fetch(`${service.url}/v1/relay?space=${space}`,{headers:{Authorization:`Bearer ${validToken}`}})
  assert.equal(relayCheck.status,200)
  const relayReader=relayCheck.body!.getReader();await relayReader.read()
  let relayClosed=false
  const observeClose=(async()=>{try{while(!(await relayReader.read()).done){}}catch(error){log('quiet relay socket closed: '+String(error))}finally{relayClosed=true}})()
  assert.equal(spawnSync('git',['rm','--cached','-q','.foundation/share.json'],{cwd:repos[0]!}).status,0)
  assert.equal(spawnSync('git',['-c','user.name=Share Proof','-c','user.email=proof@example.invalid','commit','-qm','Disable live sharing'],{cwd:repos[0]!}).status,0)
  log('DESCRIPTOR REMOVED from default-branch git HEAD; waiting for bounded cache expiry')
  await wait(31000)
  const disabled=await fetch(`${service.url}/v1/state?space=${space}`,{headers:{Authorization:`Bearer ${validToken}`}})
  assert.ok([401,412].includes(disabled.status));log(`REMOVED DESCRIPTOR REFUSED existing token: HTTP ${disabled.status}`)
  await until(()=>relayClosed,'quiet relay closes after descriptor removal',65000)
  await observeClose
  log('DESCRIPTOR REMOVAL: existing token refused and quiet SSE disconnected')
  for (const child of [a, b]) child.kill('SIGTERM')
  await wait(1000)
  await service.close()
  await backupShareService(serviceConfig, join(root, 'backup'))
  assert.ok(readdirSync(join(root, 'backup/comb-store')).length)
  log('complete stopped local-store backup includes metadata and Comb objects')
  log(
    'PASS real two-HOME CLI/daemon/Comb encrypted sharing, handover, subsecond bidirectional visibility, refusal, removal/rotation, raw-store grep, outage and backup'
  )
} finally {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
  await service.close()
  await new Promise<void>((r) => stub.close(() => r()))
}
