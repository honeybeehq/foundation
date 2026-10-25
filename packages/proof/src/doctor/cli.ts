import { scan, probe } from './check.ts';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const [repo, entry, url, root, expectedText, size] = process.argv.slice(2);
if (!repo || !entry) { console.error('Usage: pnpm exec tsx packages/proof/src/doctor/cli.ts <repo> <entry#Export> [harness-url] [root-selector] [expected-text] [widthxheight@dpr]'); process.exit(2); }
const source=scan(repo,entry);
let repoCommit: string | null=null;
try {repoCommit=execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();} catch { /* Non-git repositories are supported. */ }
let runtime: unknown={verdict:'not-provable',reason:'No harness URL supplied; source scan is advisory, not proof.'};
const dimensions=size?.match(/^(\d+)x(\d+)@([\d.]+)$/);
if(size && (!dimensions || !dimensions.slice(1).every(n=>Number(n)>0))) {console.error('Invalid viewport: use widthxheight@dpr');process.exit(2);}
const viewport=dimensions?{width:Number(dimensions[1]),height:Number(dimensions[2]),dpr:Number(dimensions[3])}:undefined;
if(url) {try {runtime=await probe(url,root,expectedText,viewport);} catch(error) {runtime={verdict:'not-provable',reason:String(error)};}}
const doctorDirectory=dirname(fileURLToPath(import.meta.url));
let doctorCommit: string | null=null; let doctorDirty: boolean | null=null;
try {doctorCommit=execFileSync('git',['-C',doctorDirectory,'rev-parse','HEAD'],{encoding:'utf8'}).trim();doctorDirty=Boolean(execFileSync('git',['-C',doctorDirectory,'status','--porcelain','--','.'],{encoding:'utf8'}).trim());} catch {}
console.log(JSON.stringify({schema:'fdn-doctor/0',doctorCommit,doctorDirty,repoCommit,entry,source,runtime},null,2));
