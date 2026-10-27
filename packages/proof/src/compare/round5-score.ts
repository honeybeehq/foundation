/** One post-freeze scoring run for B1. The manifest supplies released labels. */
import {access,mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {compare,readCapture} from './index.ts';
import {csv,defectMetrics} from './ground-truth.ts';
const [manifestPath,out]=process.argv.slice(2);
if(!manifestPath || !out) throw Error('Usage: round5-score.ts MANIFEST OUT');
const manifest:{frozenRules:string;cases:{name:string;pair:string;labels:string}[]}=JSON.parse(await readFile(manifestPath,'utf8'));
if(!/^[a-f0-9]{40}$/.test(manifest.frozenRules)) throw Error('Manifest must identify the frozen rules commit');
const delta=execFileSync('git',['diff',manifest.frozenRules,'--','packages/proof/src/compare','packages/proof/src/capture'],{encoding:'utf8'});
if(delta) throw Error('Checker or capture source differs from frozen rules');
try {await access(out+'/attempt.json');throw Error('A score attempt already exists; labels must not be used for retuning');}
catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT') throw e;}
await mkdir(out,{recursive:true});
await writeFile(out+'/attempt.json',JSON.stringify({frozenRules:manifest.frozenRules,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDiffBytes:0,at:new Date().toISOString()},null,2)+'\n');
const results=[];
for(const entry of manifest.cases) {
 const a=await readCapture(entry.pair+'/design'),b=await readCapture(entry.pair+'/code');
 const labelText=await readFile(entry.labels,'utf8'),labels=csv(labelText);
 const modes=[];
 for(const mode of ['full','layout-only'] as const) {
  const report=compare(a,b,{}, {mode}).report;
  const truth=mode==='layout-only'?labels.filter(l=>l.kind==='layout'):labels;
  const result={mode,provable:report.provable,
    strict:report.provable?defectMetrics(report.defects,report.drifts,truth,a.nodes,b.nodes,{strictScope:true}):null,
    optimistic:report.provable?defectMetrics(report.defects,report.drifts,truth,a.nodes,b.nodes):null,
    ...(report.provable?{}:{reason:report.reason})};
  await writeFile(`${out}/${entry.name}-${mode}.json`,JSON.stringify({result,report},null,2)+'\n');modes.push(result);
 }
 results.push({case:entry.name,labelSha256:createHash('sha256').update(labelText).digest('hex'),modes});
}
await writeFile(out+'/summary.json',JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results.map(r=>({case:r.case,modes:r.modes.map(m=>({mode:m.mode,provable:m.provable,strict:m.strict?{tp:m.strict.tp,fp:m.strict.fp,fn:m.strict.fn,precision:m.strict.precision,recall:m.strict.recall}:null,optimistic:m.optimistic?{tp:m.optimistic.tp,fp:m.optimistic.fp,fn:m.optimistic.fn,precision:m.optimistic.precision,recall:m.optimistic.recall}:null}))})),null,2));
