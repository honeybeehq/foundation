import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import {captureFullExtent} from '../capture/extent.ts';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import { collectDom } from '../capture/dom.ts';
import {compare} from './index.ts';
import {makeAcceptance,evaluateAccepted,withAcceptanceInputs} from '../accept/index.ts';
import { offscreenDefects } from './offscreen.ts';
import type { Capture } from './types.ts';
let browser: Browser, page: Page;
beforeAll(async () => {
  browser = await chromium.launch(); page = await browser.newPage({viewport:{width:400,height:300}});
  await page.evaluate('globalThis.__name = f => f');
});
afterAll(async () => { await browser?.close(); });
async function capture(content: string): Promise<Capture> {
  await page.setContent(`<style>body{margin:0}#root{width:300px;height:200px;overflow:hidden;position:relative}button{width:80px;height:24px}</style><div id="root">${content}</div>`);
  const dom = await collectDom(page,'#root');
  return {nodes:dom.nodes as Capture['nodes'],meta:{frame:{width:300,height:200},extent:dom.extent},screenshot:await page.screenshot()};
}
it('finds a below-frame action bar once, retaining all child boxes',async () => {
  const a=await capture('<div><button>Accept</button><button>Discard</button></div>');
  const b=await capture('<div style="position:absolute;top:350px"><button>Accept</button><button>Discard</button></div>');
  const defects=offscreenDefects(a,b,[]);
  expect(defects).toHaveLength(1); expect(defects[0]).toMatchObject({kind:'layout',cause:'offscreen',classification:'product'});
  expect(defects[0]!.summary).toContain('Accept · Discard');
  expect(defects[0]!.offscreen!.elements).toHaveLength(2);
  expect(b.meta.extent.scroll[1]).toBeGreaterThan(350);
});
it('detects clipping by an ancestor wholly inside the frame',async () => {
  const a=await capture('<div><button>Save</button></div>');
  const b=await capture('<div style="height:10px;overflow:hidden"><button>Save</button></div>');
  expect(offscreenDefects(a,b,[])).toHaveLength(1);
});
it('does not flag equivalent design scroll overflow',async () => {
  const html='<div data-fdn-id="list" style="height:80px;overflow:auto"><div style="height:120px"></div><button>Last item</button></div>';
  const a=await capture(html),b=await capture(html);
  expect(offscreenDefects(a,b,[])).toHaveLength(0);
});
it('treats content moved within a functioning scroller as reachable layout drift',async () => {
  const a=await capture('<div data-fdn-id="list" style="height:80px;overflow:auto"><button>Last item</button></div>');
  const b=await capture('<div data-fdn-id="list" style="height:80px;overflow:auto"><div style="height:120px"></div><button>Last item</button></div>');
  expect(offscreenDefects(a,b,[])).toHaveLength(0);
});
it('does not count new reachable scroll content as an independent visibility defect',async () => {
  const a=await capture('<div data-fdn-id="list" style="height:80px;overflow:auto"><div style="height:120px"></div><button>Last item</button></div>');
  const b=await capture('<div data-fdn-id="list" style="height:80px;overflow:auto"><div style="height:120px"></div><button>Last item</button><button>New action</button></div>');
  expect(offscreenDefects(a,b,[])).toHaveLength(0);
});
it('preserves equivalent clipped pan content but catches controls moved outside it',async () => {
  const content='<div data-fdn-id="canvas" style="height:80px;overflow:hidden;touch-action:none"><div style="transform:translateY(100px)"><span>Graph card</span></div></div>';
  const a=await capture(content+'<button>Accept</button>');
  const b=await capture(content+'<div style="position:absolute;top:350px"><button>Accept</button></div>');
  expect(offscreenDefects(a,b,[])).toHaveLength(1);
  expect(b.nodes.find(n=>n.text==='Graph card')!.visibility!.clips.some(c=>c.pan)).toBe(true);
});
it('ignores display:none, visibility:hidden and transparent ancestor subtrees',async () => {
  const a=await capture('');
  const b=await capture('<div style="opacity:0;position:absolute;top:400px"><button>Hidden</button></div><button style="display:none">Gone</button><button style="visibility:hidden;position:absolute;top:400px">Invisible</button>');
  expect(offscreenDefects(a,b,[])).toHaveLength(0);
});

it('captures beyond the viewport without changing measured layout or leaving clips disabled',async () => {
  const a=await capture('<div style="position:absolute;top:350px;left:-80px"><button>Accept</button></div>');
  const dir=await mkdtemp(join(tmpdir(),'fdn-extent-'));
  try {
    await captureFullExtent(page,'#root',join(dir,'extent.png'));
    const png=PNG.sync.read(await readFile(join(dir,'extent.png')));
    expect(png.height).toBeGreaterThan(350);
    expect(png.width).toBeGreaterThan(300);
    expect((await collectDom(page,'#root')).nodes).toEqual(a.nodes);
  } finally {await rm(dir,{recursive:true,force:true});}
});
it('gives repeated clipped data-fdn-id rows different defect identities',async () => {
  const a=await capture('<button data-fdn-id="item">One</button><button data-fdn-id="item">Two</button>');
  const b=await capture('<button data-fdn-id="item" style="position:absolute;top:350px">One</button><button data-fdn-id="item" style="position:absolute;top:450px">Two</button>');
  const ds=offscreenDefects(a,b,[]);
  expect(ds).toHaveLength(2);expect(new Set(ds.map(d=>d.id)).size).toBe(2);
  expect(ds.map(d=>d.layer.code)).toEqual(['0/0','0/1']);
});
it('checks the viewport even when the declared frame is taller',async () => {
  const a=await capture('<button>Below fold</button>');
  const b=await capture('<button style="position:absolute;top:250px">Below fold</button>');
  b.meta.frame.height=500; b.meta.extent.viewport=[0,0,300,200];
  expect(offscreenDefects(a,b,[])).toHaveLength(1);
});

it('names missing offscreen coverage on legacy captures',async () => {
  const a=await capture('<button>Save</button>');
  const legacy={...a,nodes:a.nodes.map(({visibility,...n})=>n)};
  expect(compare(legacy,legacy).report.offscreen).toMatchObject({status:'unavailable',reason:expect.stringContaining('offscreen-unavailable')});
  expect(compare(a,a).report.offscreen.status).toBe('measured');
});
it('makes offscreen acceptance stale when invisible geometry, clip or contents change',async () => {
  const a=await capture('<button>Accept</button>');
  const b=await capture('<button style="position:absolute;top:350px">Accept</button>');
  const r=withAcceptanceInputs({...compare(a,b).report,provable:true,design:{htmlSha256:'a'.repeat(64),head:'b'.repeat(64)},code:{root:'test#View'}},{design:a,code:b});
  const d=r.defects.find((d:any)=>d.cause==='offscreen');
  const list={schema:'fdn-accepted/0' as const,entries:[makeAcceptance(r,d.id,'Intentional test overflow','Reviewer')]};
  expect(evaluateAccepted(r,list).accepted).toContain(d.id);
  for(const change of ['geometry','clip','contents']) {
    const changed=structuredClone(r), drift=changed.drifts.find((d:any)=>d.property==='offscreen');
    if(change==='geometry') drift.code.box[1]+=30;
    if(change==='clip') drift.code.clips[0].box[3]-=10;
    if(change==='contents') drift.code.summary+=' changed';
    expect(evaluateAccepted(changed,list).errors.join(' ')).toContain('measured value changed');
  }
});

it('restores intentional scroll positions after diagnostic paint',async () => {
  await capture('<div id="list" style="height:80px;overflow:auto"><div style="height:120px"></div><button>Last item</button></div>');
  await page.locator('#list').evaluate(el=>el.scrollTop=100);
  const before=await collectDom(page,'#root');
  const dir=await mkdtemp(join(tmpdir(),'fdn-scroll-'));
  try {
    const diagnostic=await captureFullExtent(page,'#root',join(dir,'extent.png'));
    expect(diagnostic.sha256).toHaveLength(64);
    expect((await collectDom(page,'#root')).nodes).toEqual(before.nodes);
  } finally {await rm(dir,{recursive:true,force:true});}
});

it('recognizes unique exact clipped text across text-only and mixed-content wrappers',async () => {
  const a=await capture('<div style="position:absolute;top:350px"><span>Proposal explanation</span></div>');
  const b=await capture('<div style="position:absolute;top:350px">Proposal explanation<span aria-hidden="true"></span></div>');
  expect(offscreenDefects(a,b,[])).toHaveLength(0);
  const visible=await capture('<span>Proposal explanation</span>');
  expect(offscreenDefects(visible,b,[])).toHaveLength(1);
});

it('does not excuse a clipped action using non-interactive design text',async () => {
  const a=await capture('<span style="position:absolute;top:350px">Accept</span>');
  const b=await capture('<button style="position:absolute;top:350px">Accept</button>');
  expect(offscreenDefects(a,b,[])).toHaveLength(1);
});
it('uses unique nearby card text to disambiguate repeated clipped labels',async()=>{
 const rows='<div style="position:absolute;top:350px"><span>Unique first</span><span>ACTION</span></div><div style="position:absolute;top:450px"><span>Unique second</span><span>ACTION</span></div>';
 const a=await capture(rows),b=await capture(rows.replaceAll('<span>ACTION</span>','<div><span>ACTION</span></div>'));
 expect(offscreenDefects(a,b,[])).toHaveLength(0);
});
it('keeps the real Flow View proposal bar and removes repeated-label alarms',async()=>{
 const {readCapture}=await import('./index.ts');
 const base='packages/proof/fixtures/sample-captures/tracks-pane-flowview';
 for(const [state,expected] of [['track-selected',0],['proposal-pending',1],['empty',0]] as const) {
  const a=await readCapture(`${base}/${state}/1416x720@1/design`),b=await readCapture(`${base}/${state}/1416x720@1/code`);
  const ds=offscreenDefects(a,b,[]);
  expect(ds).toHaveLength(expected);
  if(expected) expect(ds[0]!.summary).toContain('Accept');
 }
},20000);
