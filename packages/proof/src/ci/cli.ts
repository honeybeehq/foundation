import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {compareDirectories,readCapture,captureHash} from '../compare/index.ts';
import {canonical} from '../compare/canonical.ts';
import {bindAccepted,readAccepted} from '../accept/index.ts';
import {writeManifest,writeReport,verify} from '../report/index.ts';
import {jobSummary} from '../report/summary.ts';
const [command,...args]=process.argv.slice(2);
const opt=(k:string,f?:string)=>args.includes(k)?args[args.indexOf(k)+1]:f;
if(command==='capture-code') {process.argv=[...process.argv.slice(0,2),...args];await import('../capture/code-cli.ts');}
else if(command==='accept') {process.argv=[...process.argv.slice(0,2),'accept',...args];await import('../accept/cli.ts');}
else if(command==='check') {
 const repo=path.resolve(opt('--code','.')!),baseline=path.resolve(opt('--baseline','.foundation/baseline')!),out=path.resolve(opt('--out','proof-output')!);
 const policy=JSON.parse(await readFile(opt('--policy')!,'utf8')),links=JSON.parse(await readFile(path.join(repo,'.foundation/links.json'),'utf8'));
 if(!policy.baseline || links.designHead!==policy.baseline.head || links.designHtmlSha256!==policy.baseline.htmlSha256) throw Error('Links design binding differs from trusted base policy; regenerate and review the baseline');
 const accepted=await readAccepted(path.join(repo,'.foundation/accepted.json')),reports=[],files=[];
 const started=performance.now();
 for(const required of policy.required) {
  const rel=path.join(required.artboard,required.state,`${required.viewport.width}x${required.viewport.height}@${required.viewport.dpr}`);
  const destination=path.join(out,required.state),r=await compareDirectories(path.join(baseline,rel,'design'),path.join(opt('--captures','captures')!,rel,'code'),destination,policy.tolerances);
  const file=path.join(destination,'drift-report.json');
  const bound=bindAccepted(r,accepted);await writeReport(file,bound); reports.push(bound);files.push(file);
 }
 await writeManifest(path.join(out,'proof-manifest.json'),files);
 const result=await verify(path.join(out,'proof-manifest.json'),{codeRepo:repo,designRepo:repo,policy});
 await writeFile(path.join(out,'verification.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
 const summary=jobSummary(reports,result,opt('--mode','advisory')!,opt('--artifact-url','.')!,{compareVerifyMs:Math.round(performance.now()-started)});
 await writeFile(path.join(out,'summary.md'),summary);
 if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
 if(!result.passed) {if(opt('--mode','advisory')==='required') process.exitCode=1; else console.log('::warning::Design proof found drift or incomplete coverage (advisory mode)');}
} else throw Error('foundation-proof capture-code|check|accept ...');
