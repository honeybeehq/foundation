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
import { join, resolve } from 'node:path'
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
const serviceConfig = {
  stateDir,
  comb: heldMode
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
        FOUNDATION_SHARE_TEST_GITHUB: github,
        FOUNDATION_REPLICA_STORE: join(homes[index]!, 'replicas'),
        FOUNDATION_NODE_ID: ids[index]
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
      FOUNDATION_SHARE_TEST_GITHUB: github,
      FOUNDATION_REPLICA_STORE: join(homes[index]!, 'replicas'),
      FOUNDATION_NODE_ID: ids[index]
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  children.push(child)
  child.stderr!.on('data', (d) => log(`daemon ${ids[index]}: ${String(d).trim()}`))
  return child
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
  const init = await ok(
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
  assert.match(init, /Recovery code saved privately/)
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
  const b = daemon(1)
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
