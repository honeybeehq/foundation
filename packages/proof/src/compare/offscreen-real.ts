/** Replay full-DOM captures with and without the independent detector. */
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {readCapture,compare} from './index.ts';
const captures=process.argv[2], out=process.argv[3];
if(!captures || !out) throw Error('Usage: tsx offscreen-real.ts CAPTURES OUT');
await mkdir(out,{recursive:true});
const results=[];
for(const state of ['track-selected','proposal-pending','empty']) {
  const pair=join(captures,'tracks-pane',state,'1416x720@1');
  const design=await readCapture(join(pair,'design')), code=await readCapture(join(pair,'code'));
  const before=compare(design,{...code,nodes:code.nodes.map(({visibility,...n})=>n)}).report;
  const after=compare(design,code).report;
  if(JSON.stringify(before.drifts)!==JSON.stringify(after.drifts.filter(d=>d.property!=='offscreen')) || JSON.stringify(before.matches)!==JSON.stringify(after.matches)) throw Error('Frozen matching changed');
  const added=after.defects.filter(d=>d.cause==='offscreen');
  await writeFile(join(out,`${state}-before.json`),JSON.stringify(before.defects,null,2)+'\n');
  await writeFile(join(out,`${state}-after.json`),JSON.stringify(after.defects,null,2)+'\n');
  results.push({state,before:before.summary.uniqueDefects,after:after.summary.uniqueDefects,added:added.length,defects:added});
}
const proposal=results.find(r=>r.state==='proposal-pending')!;
if(proposal.defects.filter(d=>d.summary.includes('Accept') && d.summary.includes('Discard')).length!==1) throw Error('Missing proposal controls');
await writeFile(join(out,'results.json'),JSON.stringify(results,null,2)+'\n');
console.log(results.map(({defects,...r})=>r));
