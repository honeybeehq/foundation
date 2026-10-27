/** Frozen held-out scorer: explicit released-label manifest; refuses overwrite. */
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {readCapture,compare} from './index.ts';
import {csv,defectMetrics} from './ground-truth.ts';
const [manifestFile,out]=process.argv.slice(2);
if(!manifestFile || !out) throw Error('Usage: round4-heldout.ts MANIFEST OUT');
try {await access(out+'/summary.json');throw Error('Held-out score already exists; do not rescore after seeing labels');}
catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT') throw e;}
const manifest: {case:string;pair:string;labels:string}[]=JSON.parse(await readFile(manifestFile,'utf8'));
await mkdir(out,{recursive:true});
const rows=[];
for(const entry of manifest) {
 const a=await readCapture(entry.pair+'/design'),b=await readCapture(entry.pair+'/code');
 const report=compare(a,b).report;
 const labels=csv(await readFile(entry.labels,'utf8'));
 const row={case:entry.case,optimistic:defectMetrics(report.defects,report.drifts,labels,a.nodes,b.nodes),strict:defectMetrics(report.defects,report.drifts,labels,a.nodes,b.nodes,{strictScope:true})};
 await writeFile(`${out}/${entry.case}.json`,JSON.stringify({result:row,report},null,2)+'\n');rows.push(row);
}
await writeFile(out+'/summary.json',JSON.stringify(rows,null,2)+'\n');
console.log(JSON.stringify(rows.map(r=>({case:r.case,optimistic:{tp:r.optimistic.tp,fp:r.optimistic.fp,fn:r.optimistic.fn},strict:{tp:r.strict.tp,fp:r.strict.fp,fn:r.strict.fn}})),null,2));
