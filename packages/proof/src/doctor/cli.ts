import { scan, probe } from './check.ts';
import { execFileSync } from 'node:child_process';
const [repo, entry, url, root] = process.argv.slice(2);
if (!repo || !entry) { console.error('Usage: pnpm exec tsx packages/proof/src/doctor/cli.ts <repo> <entry#Export> [harness-url] [root-selector]'); process.exit(2); }
const source=scan(repo,entry);
let repoCommit: string | null=null;
try {repoCommit=execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();} catch { /* Non-git repositories are supported. */ }
let runtime: unknown={verdict:'not-provable',reason:'No harness URL supplied; source scan is advisory, not proof.'};
if(url) {try {runtime=await probe(url,root);} catch(error) {runtime={verdict:'not-provable',reason:String(error)};}}
console.log(JSON.stringify({schema:'fdn-doctor/0',repoCommit,entry,source,runtime},null,2));
