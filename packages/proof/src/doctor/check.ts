/** Advisory source scan + observed Chromium isolation probe. Not a security sandbox. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

type Finding = { kind: string; file: string; line: number; detail: string };
export function scan(repo: string, entry: string) {
  const seen = new Set<string>(); const findings: Finding[] = []; const unresolved = new Set<string>();
  function visit(file: string) {
    if (seen.has(file)) return; seen.add(file);
    const source = readFileSync(file, 'utf8');
    const add = (kind: string, at: number, detail: string) => findings.push({kind, file: relative(repo, file), line: source.slice(0, at).split('\n').length, detail});
    // Deliberately conservative lexical scan: includes effects/handlers, not only render.
    const risks = /\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|Date\.now\s*\(|Math\.random\s*\(|crypto\.randomUUID\s*\(|setInterval\s*\(|setTimeout\s*\(|localStorage|sessionStorage|ipcRenderer|window\.(?:apiary|electron))\b/g;
    // Final word boundary would miss APIs ending with '('; use a separate expression.
    const calls = /\b(fetch\s*\(|Date\.now\s*\(|Math\.random\s*\(|crypto\.randomUUID\s*\(|setInterval\s*\(|setTimeout\s*\()/g;
    const hits = new Map<number,string>();
    for (const re of [risks,calls]) for (const m of source.matchAll(re)) hits.set(m.index!,m[0]);
    for (const [at, detail] of hits) add('ambient-api',at,detail);
    const imports = /(?:\b(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*|\bimport\s*\(|\brequire\s*\(|\bimport\s*)['"]([^'"]+)['"]/g;
    for (const m of source.matchAll(imports)) {
      const spec = m[1]!;
      if (/^(electron|node:|ws$|socket\.io|axios|@tauri-apps)/.test(spec)) add('forbidden-import',m.index!,spec);
      if (!spec.startsWith('.')) { unresolved.add(spec); continue; }
      const base = resolve(dirname(file),spec);
      const found = [base,...['.tsx','.ts','.jsx','.js','/index.tsx','/index.ts','/index.jsx','/index.js'].map(s=>base+s)].find(p=>existsSync(p)&&/\.[cm]?[jt]sx?$/.test(p));
      if (found) visit(found); else if (!['.css','.svg','.png','.json'].includes(extname(spec))) unresolved.add(spec);
    }
  }
  visit(resolve(repo,entry.split('#')[0]!));
  return {files:seen.size, findings, externalOrUnresolved:[...unresolved].sort(), limitation:'Lexical scan; relative imports only; packages/aliases are coverage gaps. Findings include handlers and effects. Runtime required.'};
}

export async function probe(url: string, root = '#root', expectedText?: string, viewport={width:1280,height:800,dpr:1}) {
  const environment={viewport:{width:viewport.width,height:viewport.height},dpr:viewport.dpr,clock:'2023-11-14T22:13:20Z',random:0.314159265};
  const browser = await chromium.launch({headless:true});
  const runs: {hash:string; screenshotHash:string; events:string[];timers?:unknown[];pendingTimers?:unknown[]}[]=[];
  try {
    for (let i=0;i<2;i++) {
      const context = await browser.newContext({viewport:environment.viewport,deviceScaleFactor:environment.dpr,locale:'en-US',timezoneId:'UTC',reducedMotion:'reduce',serviceWorkers:'block'});
      const events:string[]=[]; const page=await context.newPage();
      await page.clock.setFixedTime(new Date(environment.clock));
      page.on('pageerror', e=>events.push(`error: ${e.message}`));
      page.on('console', message=>{ if(message.type()==='error') events.push(`console-error: ${message.text()}`); });
      await context.route('**/*',route=> {
        const req=route.request();
        if (['document','script','stylesheet','image','font'].includes(req.resourceType()) && new URL(req.url()).origin===new URL(url).origin && req.method()==='GET') return route.continue();
        events.push(`blocked-network: ${req.method()} ${req.url()}`); return route.abort();
      });
      // Use literal JS: tsx/esbuild keepNames helpers are not present in the browser realm.
      await page.addInitScript({content:`
        const state = {events:[],timers:[],pending:new Map()}; window.__foundationDoctor=state;
        const record=(message)=>state.events.push(message);
        Math.random=()=>${environment.random};
        for (const name of ['WebSocket','EventSource']) Object.defineProperty(window,name,{value:class {constructor(){record('blocked-'+name);throw new Error(name+' needs fixture');}}});
        const timeout=window.setTimeout.bind(window), clear=window.clearTimeout.bind(window);
        window.setTimeout=(fn,ms,...args)=>{record('timer: timeout '+(ms??0));const info={delay:ms??0,stack:new Error().stack};state.timers.push(info);const handle=timeout(()=>{state.pending.delete(handle);if(typeof fn==='function')fn.apply(window,args);else (0,eval)(fn);},ms);state.pending.set(handle,info);return handle;};
        window.clearTimeout=(handle)=>{state.pending.delete(handle);clear(handle);};
        window.setInterval=()=>{record('blocked-interval');return 0;};
        for (const name of ['apiary','electron']) Object.defineProperty(window,name,{configurable:true,get(){record('unmocked-bridge: '+name);throw new Error(name+' needs harness.prepare fixture');}});
      `});
      try {
        await page.goto(url,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>Boolean((window as unknown as {__foundationReady?:boolean}).__foundationReady),{},{timeout:15000});
        await page.evaluate(async()=>{await document.fonts.ready;const style=document.createElement('style');style.textContent='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';document.head.append(style);for(const animation of document.getAnimations()){animation.pause();animation.currentTime=0;}await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));});
        await page.waitForFunction(()=>(window as unknown as {__foundationDoctor:{pending:Set<number>}}).__foundationDoctor.pending.size===0,{},{timeout:15000});
        await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
        await page.waitForFunction(()=>(window as unknown as {__foundationDoctor:{pending:Set<number>}}).__foundationDoctor.pending.size===0,{},{timeout:15000});
        if(expectedText && !(await page.locator(root).innerText()).includes(expectedText)) throw new Error(`Expected fixture text absent: ${expectedText}`);
        const html=await page.locator(root).evaluate(el=>{if (!el.childNodes.length) throw new Error('Empty proof root'); return el.outerHTML;});
        runs.push({hash:createHash('sha256').update(html).digest('hex'),screenshotHash:createHash('sha256').update(await page.locator(root).screenshot()).digest('hex'),events});
      } catch(e) { events.push(`probe-failed: ${String(e)}`); runs.push({hash:'',screenshotHash:'',events}); }
      try { events.push(...await page.evaluate(()=>(window as unknown as {__foundationDoctor:{events:string[]}}).__foundationDoctor.events)); } catch { /* Navigation may have failed before init. */ }
      try {const pending=await page.evaluate(()=>[...(window as unknown as {__foundationDoctor:{pending:Map<number,unknown>}}).__foundationDoctor.pending.values()]);runs[runs.length-1]!.pendingTimers=pending;if(pending.length)events.push('pending-timers: '+JSON.stringify(pending));} catch {}
      try {runs[runs.length-1]!.timers=await page.evaluate(()=>(window as unknown as {__foundationDoctor:{timers:unknown[]}}).__foundationDoctor.timers);} catch {}
      await context.close();
    }
  } finally {await browser.close();}
  const deterministic=Boolean(runs[0]?.hash)&&runs[0]?.hash===runs[1]?.hash&&runs[0]?.screenshotHash===runs[1]?.screenshotHash;
  const effectsRepeatable=JSON.stringify([...(runs[0]?.events??[])].sort())===JSON.stringify([...(runs[1]?.events??[])].sort());
  const failures=runs.flatMap(r=>r.events.filter(e=>!e.startsWith('timer:')));
  const reason=failures.length ? [...new Set(failures)].join('; ') : !deterministic ? 'Fresh renders produced different DOM or screenshot hashes' : !effectsRepeatable ? 'Timer/effect event counts differed between fresh renders' : !expectedText ? 'No expected fixture text supplied; intended state was not asserted' : undefined;
  return {url,root,expectedText:expectedText??null,environment,runs,deterministic,effectsRepeatable,verdict:reason?'not-provable':'probe-passed',...(reason?{reason}:{}),limitation:'Timeouts observed and awaited until none pending (15s limit), intervals blocked. Storage, observers and portal targets remain harness responsibilities. Asset allowlist is same-origin GET; not a hostile-code sandbox. Two samples cannot prove all states; without expectedText no fixture-state assertion is made.'};
}
