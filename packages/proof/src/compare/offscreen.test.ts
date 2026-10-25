import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import {captureFullExtent} from '../capture/extent.ts';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import { collectDom } from '../capture/dom.ts';
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
  return {nodes:dom.nodes as Capture['nodes'],meta:{frame:{width:300,height:200},extent:dom.extent},screenshot:Buffer.alloc(0)};
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
it('does not exempt code scroll overflow when design content fits',async () => {
  const a=await capture('<div data-fdn-id="list" style="height:80px;overflow:auto"><button>Last item</button></div>');
  const b=await capture('<div data-fdn-id="list" style="height:80px;overflow:auto"><div style="height:120px"></div><button>Last item</button></div>');
  expect(offscreenDefects(a,b,[])).toHaveLength(1);
});
it('does not exempt a new offscreen control in an otherwise intentional scroller',async () => {
  const a=await capture('<div data-fdn-id="list" style="height:80px;overflow:auto"><div style="height:120px"></div><button>Last item</button></div>');
  const b=await capture('<div data-fdn-id="list" style="height:80px;overflow:auto"><div style="height:120px"></div><button>Last item</button><button>New action</button></div>');
  expect(offscreenDefects(a,b,[]).map(d=>d.summary)).toEqual(['rendered outside the visible pane: New action']);
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
  const a=await capture('<div style="position:absolute;top:350px"><button>Accept</button></div>');
  const dir=await mkdtemp(join(tmpdir(),'fdn-extent-'));
  try {
    await captureFullExtent(page,'#root',join(dir,'extent.png'));
    const png=PNG.sync.read(await readFile(join(dir,'extent.png')));
    expect(png.height).toBeGreaterThan(350);
    expect((await collectDom(page,'#root')).nodes).toEqual(a.nodes);
  } finally {await rm(dir,{recursive:true,force:true});}
});
