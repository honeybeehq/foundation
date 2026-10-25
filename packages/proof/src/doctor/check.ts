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

export async function probe(url: string, root = '#root') {
  const browser = await chromium.launch({headless:true});
  const runs: {hash:string; screenshotHash:string; events:string[]}[]=[];
  try {
    for (let i=0;i<2;i++) {
      const context = await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1,locale:'en-US',timezoneId:'UTC',reducedMotion:'reduce',serviceWorkers:'block'});
      const events:string[]=[]; const page=await context.newPage();
      await page.clock.setFixedTime(new Date('2023-11-14T22:13:20Z'));
      page.on('pageerror', e=>events.push(`error: ${e.message}`));
      page.on('console', message=>{ if(message.type()==='error') events.push(`console-error: ${message.text()}`); });
      await context.route('**/*',route=> {
        const req=route.request();
        if (['document','script','stylesheet','image','font'].includes(req.resourceType()) && new URL(req.url()).origin===new URL(url).origin && req.method()==='GET') return route.continue();
        events.push(`blocked-network: ${req.method()} ${req.url()}`); return route.abort();
      });
      await page.addInitScript(()=> {
        const state = {events:[] as string[]}; Object.assign(window,{__foundationDoctor:state});
        const record=(s:string)=>state.events.push(s);
        Math.random=()=>0.314159265;
        for (const name of ['WebSocket','EventSource'] as const) Object.defineProperty(window,name,{value:class {constructor(){record(`blocked-${name}`);throw new Error(`${name} needs fixture`);}}});
        const timeout=window.setTimeout.bind(window); const interval=window.setInterval.bind(window);
        window.setTimeout=((fn:TimerHandler,ms?:number,...args:unknown[])=>{record(`timer: timeout ${ms??0}`); return timeout(fn,ms,...args);}) as typeof window.setTimeout;
        window.setInterval=((..._args:unknown[])=>{record('blocked-interval');return 0;}) as typeof interval;
        for (const name of ['apiary','electron']) Object.defineProperty(window,name,{configurable:true,get(){record(`unmocked-bridge: ${name}`);throw new Error(`${name} needs harness.prepare fixture`);}});
      });
      try {
        await page.goto(url,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>Boolean((window as unknown as {__foundationReady?:boolean}).__foundationReady),{},{timeout:15000});
        await page.evaluate(async()=>{await document.fonts.ready;const style=document.createElement('style');style.textContent='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';document.head.append(style);for(const animation of document.getAnimations()){animation.pause();animation.currentTime=0;}await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));});
        const html=await page.locator(root).evaluate(el=>{if (!el.childNodes.length) throw new Error('Empty proof root'); return el.outerHTML;});
        runs.push({hash:createHash('sha256').update(html).digest('hex'),screenshotHash:createHash('sha256').update(await page.locator(root).screenshot()).digest('hex'),events});
      } catch(e) { events.push(`probe-failed: ${String(e)}`); runs.push({hash:'',screenshotHash:'',events}); }
      try { events.push(...await page.evaluate(()=>(window as unknown as {__foundationDoctor:{events:string[]}}).__foundationDoctor.events)); } catch { /* Navigation may have failed before init. */ }
      await context.close();
    }
  } finally {await browser.close();}
  const deterministic=Boolean(runs[0]?.hash)&&runs[0]?.hash===runs[1]?.hash&&runs[0]?.screenshotHash===runs[1]?.screenshotHash;
  return {url,root,viewport:{width:1280,height:800,dpr:1},clock:'2023-11-14T22:13:20Z',random:0.314159265,runs,deterministic,verdict:deterministic&&runs.every(r=>r.events.every(e=>e.startsWith('timer:')))?'probe-passed':'not-provable',limitation:'Timeouts observed, intervals blocked. Storage, observers and portal targets remain harness responsibilities. Asset allowlist is same-origin GET; not a hostile-code sandbox. Two samples cannot prove all states.'};
}
