/** Repeat the measurements without capture mutation. Writes deterministic receipts. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {compare,readCapture} from './index.ts';
import {canonical,hash} from './canonical.ts';
const out=process.argv[2] ?? 'research/round4/checks';
await mkdir(out,{recursive:true});
const cases=[['keycap','default','160x60@1'],['inbox-row','selected','340x100@1'],['inbox-row','failed','340x100@1'],['help-center','agent-run','1480x830@1']];
const pairs=cases.map(([c,s,z])=>({name:c+'-'+s,path:`packages/proof/fixtures/components/${c}/captures/${c}/${s}/${z}`}));
for(const state of ['track-selected','proposal-pending','empty']) pairs.push({name:'tracks-'+state,path:`packages/proof/fixtures/sample-captures/tracks-pane-flowview/${state}/1416x720@1`});
const receipts=[];
for(const p of pairs) {
 const a=await readCapture(p.path+'/design'),b=await readCapture(p.path+'/code');
 const x=compare(a,b),y=compare(a,b);
 const normalize=(r:typeof x.report)=>{const {timingsMs,reportHash,...rest}=r;return canonical(rest);};
 const reportEqual=normalize(x.report)===normalize(y.report),diffEqual=x.diff.equals(y.diff);
 if(!reportEqual || !diffEqual) throw Error('Non-deterministic replay: '+p.name);
 receipts.push({case:p.name,reportEqual,diffEqual,reportHash:hash(JSON.parse(normalize(x.report))),diffHash:hash(x.diff.toString('base64'))});
}
await writeFile(out+'/replay.json',JSON.stringify(receipts,null,2)+'\n');
console.log('All seven normalized reports and diff PNGs replay byte-identically');
