import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { CombBridge } from '../src/sync/bridge.js'
const dirs: string[] = []
const bridges: CombBridge[] = []
afterEach(() => { for (const bridge of bridges.splice(0)) bridge.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function fixture(body: string): CombBridge {
  const dir = mkdtempSync(join(tmpdir(), 'sync-bridge-')); dirs.push(dir)
  const path = join(dir, 'bridge.mjs')
  writeFileSync(path, `import {createInterface} from 'node:readline';const requests=[];const send=o=>process.stdout.write(JSON.stringify(o)+'\\n');createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);${body}});`)
  const bridge = new CombBridge(process.execPath, [path]); bridges.push(bridge); return bridge
}
it('correlates out-of-order concurrent replies', async () => {
  const bridge = fixture(`requests.push(r);if(requests.length===2)for(const q of requests.reverse())send({v:1,id:q.id,op:q.op,ok:true,value:q.value});`)
  const [a, b] = await Promise.all([bridge.request('head', { value: 'a' }), bridge.request('read', { value: 'b' })])
  expect(a.value).toBe('a'); expect(b.value).toBe('b')
})
it('preserves supported error frames, which have no op field', async () => {
  const bridge = fixture(`send({v:1,id:r.id,ok:false,error:{code:'backend_unavailable',message:'offline'}});`)
  await expect(bridge.request('append')).rejects.toThrow('backend_unavailable')
})
it('rejects malformed success responses before acknowledging publication', async () => {
  const bridge = fixture(`send({v:1,id:r.id,ok:true,op:'wrong'});`)
  await expect(bridge.request('append')).rejects.toThrow('operation mismatch')
})
