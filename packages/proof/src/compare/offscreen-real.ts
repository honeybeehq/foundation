/** Replay any capture tree with and without the independent detector. */
import {mkdir,writeFile,readdir} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {readCapture,compare} from './index.ts';
const captures=process.argv[2], out=process.argv[3];
if(!captures || !out) throw Error('Usage: tsx offscreen-real.ts CAPTURES OUT');
await mkdir(out,{recursive:true});
async function pairs(dir:string):Promise<string[]> {
  const entries=await readdir(dir,{withFileTypes:true});
  if(entries.some(e=>e.name==='design') && entries.some(e=>e.name==='code')) return [dir];
  return (await Promise.all(entries.filter(e=>e.isDirectory()).map(e=>pairs(join(dir,e.name))))).flat();
}
const results=[];
for(const pair of await pairs(captures)) {
  const design=await readCapture(join(pair,'design')), code=await readCapture(join(pair,'code'));
  if(design.meta.provable===false || code.meta.provable===false) continue;
  const before=compare(design,{...code,nodes:code.nodes.map(({visibility,...n})=>n)}).report;
  const after=compare(design,code).report;
  if(JSON.stringify(before.drifts)!==JSON.stringify(after.drifts.filter(d=>d.property!=='offscreen')) || JSON.stringify(before.matches)!==JSON.stringify(after.matches)) throw Error('Frozen matching changed');
  const added=after.defects.filter(d=>d.cause==='offscreen');
  const name=relative(captures,pair).replaceAll('/','-');
  await writeFile(join(out,`${name}-before.json`),JSON.stringify(before.defects,null,2)+'\n');
  await writeFile(join(out,`${name}-after.json`),JSON.stringify(after.defects,null,2)+'\n');
  results.push({pair:relative(captures,pair),state:code.meta.state,viewport:code.meta.viewport,frame:code.meta.frame,
    before:before.summary.uniqueDefects,after:after.summary.uniqueDefects,added:added.length,defects:added});
}
if(!results.length) throw Error('No provable capture pairs found');
for(const proposal of results.filter(r=>r.state==='proposal-pending'))
  if(proposal.defects.filter(d=>d.summary.includes('Accept') && d.summary.includes('Discard')).length!==1) throw Error('Missing proposal controls');
await writeFile(join(out,'results.json'),JSON.stringify(results,null,2)+'\n');
console.log(results.map(({defects,...r})=>r));
