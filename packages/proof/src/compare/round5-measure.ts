/** Label-free replay and report generation; never discovers any label files. */
import {mkdir,readdir,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {compare,readCapture} from './index.ts';
import {canonical,hash} from './canonical.ts';
const [root,out]=process.argv.slice(2);
if(!root || !out) throw Error('Usage: round5-measure.ts CAPTURES OUT');
await mkdir(out,{recursive:true});
async function pairs(path:string):Promise<string[]> {
 const entries=await readdir(path,{withFileTypes:true});
 if(entries.some(e=>e.name==='design') && entries.some(e=>e.name==='code')) return [path];
 return (await Promise.all(entries.filter(e=>e.isDirectory()).map(e=>pairs(join(path,e.name))))).flat();
}
const rows=[];
for(const pair of await pairs(root)) {
 const a=await readCapture(pair+'/design'),b=await readCapture(pair+'/code'),name=relative(root,pair).replaceAll('/','-');
 for(const mode of ['full','layout-only'] as const) {
  const first=compare(a,b,{}, {mode}),second=compare(a,b,{}, {mode});
  const normal=(report:typeof first.report)=>{const {timingsMs,reportHash,...body}=report;return canonical(body);};
  if(normal(first.report)!==normal(second.report) || !first.diff.equals(second.diff)) throw Error(`Non-deterministic ${mode} replay at ${name}`);
  await writeFile(`${out}/${name}-${mode}.json`,JSON.stringify(first.report,null,2)+'\n');
  rows.push({case:name,mode,provable:first.report.provable,reason:first.report.reason??null,summary:first.report.summary,coverage:first.report.comparison?.coverage??null,replayHash:hash(JSON.parse(normal(first.report))),replayEqual:true,diffEqual:true});
 }
}
await writeFile(out+'/summary.json',JSON.stringify(rows,null,2)+'\n');
console.log(JSON.stringify(rows.map(r=>({case:r.case,mode:r.mode,provable:r.provable,candidates:r.summary.uniqueDefects})),null,2));
