import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {PNG} from 'pngjs'
import {compare,readCapture} from '../src/compare/index.ts'
import {canonical} from '../src/compare/canonical.ts'
const [pair,out]=process.argv.slice(2)
if(!pair||!out) throw Error('Usage: tsx components.ts PAIR OUT')
await mkdir(out,{recursive:true})
const a=await readCapture(join(pair,'design')), b=await readCapture(join(pair,'code'))
const rows=[]
for(const ids of [true,false]) {
 const strip=(c:typeof a)=>({...c,nodes:c.nodes.map(n=>({...n,fdnId:null}))})
 const result=compare(ids?a:strip(a),ids?b:strip(b))
 const name=ids?'ids':'no-ids'
 await writeFile(join(out,`${name}.json`),canonical(result.report)+'\n')
 if(ids) {
  await writeFile(join(out,'diff.png'),result.diff)
  const d=PNG.sync.read(a.screenshot), c=PNG.sync.read(b.screenshot), f=PNG.sync.read(result.diff)
  const image=new PNG({width:d.width*3,height:d.height})
  for(const [i,p] of [d,c,f].entries()) PNG.bitblt(p,image,0,0,p.width,p.height,i*d.width,0)
  await writeFile(join(out,'design-code-diff.png'),PNG.sync.write(image))
 }
 rows.push({ids,...result.report.summary,matches:result.report.matches.length,compareMs:result.report.timingsMs.compare})
}
await writeFile(join(out,'counts.json'),JSON.stringify(rows,null,2)+'\n')
console.table(rows)
