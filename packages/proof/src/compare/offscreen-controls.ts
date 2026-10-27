/** Byte-check the original 14 deterministic result rows; elapsed time is excluded. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const [before,after,out]=process.argv.slice(2);
if(!before || !after || !out) throw Error('Usage: tsx offscreen-controls.ts BEFORE_MEASUREMENTS AFTER_MEASUREMENTS OUT');
const keys=['scenario','expected','found','tp','fp','fn','precision','recall','pixelRatio'];
const rows=async (p:string)=>JSON.parse(await readFile(p,'utf8'));
const a=await rows(before), b=(await rows(after)).slice(0,14);
const normalize=(rows:any[])=>JSON.stringify(rows.map(r=>Object.fromEntries(keys.map(k=>[k,r[k]]))))+'\n';
if(a.length!==14 || b.length!==14) throw Error('Expected 14 original controls');
const x=normalize(a), y=normalize(b);
await mkdir(out,{recursive:true});
await writeFile(join(out,'baseline14.json'),x);await writeFile(join(out,'current14.json'),y);
const result={byteEqual:x===y,rows:14,fields:keys,excluded:['ms','new offscreen detector fields'],sha256:createHash('sha256').update(x).digest('hex')};
await writeFile(join(out,'controlled-equality.json'),JSON.stringify(result,null,2)+'\n');
console.log(result);if(x!==y) throw Error('Original controlled results changed');
