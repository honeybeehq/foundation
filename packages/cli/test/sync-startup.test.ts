import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createChain } from 'foundation-engine'
import { skeletonDocument } from '../src/commands/new.js'
import { acquireDocumentLock } from '../src/document-lock.js'
import { materializeDocument } from '../src/disk.js'
import { registerDesign, readSyncState, statePath, writeSyncState } from '../src/sync-store.js'
import { copyKey, serveSync } from '../src/sync/daemon.js'
import { runSync } from '../src/commands/sync.js'
import { captureIo } from '../src/io.js'

it.each(['busy document', 'corrupt checkpoint'])('reports and retries a worker with %s at startup without restarting the daemon', async mode => {
  const root = mkdtempSync(join(tmpdir(), 'sync-startup-')), previous = process.env.FOUNDATION_REPLICA_STORE
  process.env.FOUNDATION_REPLICA_STORE = join(root, 'replicas')
  const file = join(root, 'board.fdn.html'), script = join(root, 'bridge.cjs'), readMarker = join(root, 'read')
  const chain = createChain(skeletonDocument('Startup'), { author: 'seed', message: 'init' }, { docId: 'startup' })
  chain.upgradeStorage(); materializeDocument(file, chain)
  const design = registerDesign(file, 'w', 'p'), key = copyKey(design)
  const shared = { cursor: '2', published: chain.changes().map(change => change.envelope.hash), lastError: null, updatedAt: new Date().toISOString(), pending: 0 }
  writeSyncState(key, shared)
  let release = mode === 'busy document' ? acquireDocumentLock(file) : () => {}
  if (mode === 'corrupt checkpoint') writeFileSync(statePath(key), '{invalid')
  writeFileSync(script, `const fs=require('fs');const rl=require('readline').createInterface({input:process.stdin});rl.on('line',l=>{const r=JSON.parse(l);let x;if(r.op==='hello')x={protocol:1,capabilities:{durable_idempotency:true,bounded_memory_read:true}};else if(r.op==='read'){fs.writeFileSync(process.argv[2],'read');x={log:r.log,events:[],next_cursor:r.cursor}}else x={log:r.log,first:'1',last:'1',cursor:'2'};process.stdout.write(JSON.stringify({v:1,id:r.id,op:r.op,ok:true,...x})+'\\n')});rl.on('close',()=>process.exit(0))`)
  const logs: string[] = [], controller = new AbortController()
  const done = serveSync({ binary: process.execPath, args: [script, readMarker] }, controller.signal, message => logs.push(message))
  const until = async (condition: () => boolean) => { const deadline = Date.now() + 2000; while (!condition()) { if (Date.now() >= deadline) throw new Error('condition timed out'); await new Promise(resolve => setTimeout(resolve, 10)) } }
  try {
    await until(() => logs.some(message => message.includes('startup:')))
    const io = captureIo(); expect(await runSync(['status', '--json'], io)).toBe(0)
    const row = JSON.parse(io.out[0]!)[0]
    expect(row.status).not.toBe('shared')
    expect(row.lastError).toContain(mode === 'busy document' ? 'startup: document is busy' : 'replica state:')
    expect(existsSync(readMarker)).toBe(false)
    if (mode === 'busy document') {
      expect(readSyncState(key).cursor).toBe(shared.cursor)
      expect(readSyncState(key).published).toEqual(shared.published)
      release(); release = () => {}
    } else {
      expect(readFileSync(statePath(key), 'utf8')).toBe('{invalid')
      writeSyncState(key, shared)
    }
    await until(() => existsSync(readMarker) && readSyncState(key).lastError === null)
    expect(controller.signal.aborted).toBe(false)
    expect(readSyncState(key).cursor).toBe(shared.cursor)
    expect(readSyncState(key).published).toEqual(shared.published)
  } finally { release(); controller.abort(); await done; if (previous === undefined) delete process.env.FOUNDATION_REPLICA_STORE; else process.env.FOUNDATION_REPLICA_STORE = previous; rmSync(root, { recursive: true, force: true }) }
}, 10000)
