/** Tuning-only replay. Never discovers or reads held-out labels. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {readCapture,compare} from './index.ts';
import {csv,defectMetrics} from './ground-truth.ts';
const root='packages/proof/fixtures/components';
const out=process.argv[2] ?? 'research/round4/after';
await mkdir(out,{recursive:true});
const results=[];
for(const [component,state,size] of [['keycap','default','160x60@1'],['inbox-row','selected','340x100@1'],['inbox-row','failed','340x100@1'],['help-center','agent-run','1480x830@1'],['tracks-flowview','track-selected','1416x720@1'],['tracks-flowview','proposal-pending','1416x720@1'],['tracks-flowview','empty','1416x720@1']]) {
 const pair=component==='tracks-flowview' ? join('packages/proof/fixtures/sample-captures/tracks-pane-flowview',state!,size!) : join(root,component!,'captures',component!,state!,size!);
 const a=await readCapture(join(pair,'design')),b=await readCapture(join(pair,'code'));
 const report=process.argv.includes('--saved')?JSON.parse(await readFile(component==='tracks-flowview' ? join('packages/proof/fixtures/design/flowview-evidence/u2/reports',state+'.drift-report.json') : join(root,component!,'reports',...(component==='inbox-row'?[state!]:[]),'ids.json'),'utf8')):compare(a,b).report;
 const labels=csv(await readFile(join('packages/proof/fixtures/ground-truth',component!,state+'.defects.csv'),'utf8'));
 const optimistic=defectMetrics(report.defects,report.drifts,labels,a.nodes,b.nodes);
 const strict=defectMetrics(report.defects,report.drifts,labels,a.nodes,b.nodes,{strictScope:true});
 const result={component,state,optimistic,strict};
 await writeFile(join(out,component+'-'+state+'.json'),JSON.stringify({result,report},null,2)+'\n');
 results.push(result);
 console.log(component,state,JSON.stringify(Object.fromEntries(Object.entries({optimistic,strict}).map(([k,v])=>[k,{tp:v.tp,fp:v.fp,fn:v.fn,precision:v.precision,recall:v.recall}]))));
}
await writeFile(join(out,'summary.json'),JSON.stringify(results,null,2)+'\n');
