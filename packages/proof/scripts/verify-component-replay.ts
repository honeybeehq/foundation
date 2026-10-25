import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
const rows=[]
for(const [component,state,size,replay] of [
 ['keycap','default','160x60@1','.work/replay/keycap'],
 ['inbox-row','selected','340x100@1','.work/replay/inbox-row'],
 ['inbox-row','failed','340x100@1','.work/replay/inbox-row'],
 ['help-center','agent-run','1480x830@1','.work/replay/help-final-repeat'],
]) for(const side of ['design','code']) {
 const relative=join(component!,state!,size!,side!)
 const committed=join('packages/proof/fixtures/components',component!,'captures',relative)
 const repeated=join(replay!,relative)
 const a=await readFile(join(committed,'screenshot.png')),b=await readFile(join(repeated,'screenshot.png'))
 const d=JSON.parse(await readFile(join(committed,'dom.json'),'utf8')),c=JSON.parse(await readFile(join(repeated,'dom.json'),'utf8'))
 const row={component,state,side,pngEqual:a.equals(b),nodeArraysEqual:JSON.stringify(d.nodes)===JSON.stringify(c.nodes),sha256:createHash('sha256').update(a).digest('hex')}
 rows.push(row)
 if(!row.pngEqual||!row.nodeArraysEqual) throw Error('Replay differs: '+JSON.stringify(row))
}
await writeFile('packages/proof/fixtures/components/evidence/replay.json',JSON.stringify(rows,null,2)+'\n')
console.log(`${rows.length}/${rows.length} PNGs and node arrays equal`)
