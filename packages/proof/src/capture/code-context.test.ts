import {it,expect} from 'vitest';
import {chromium} from 'playwright';
import {preserveCodeContext} from './code-context.ts';
import {STYLE_PROPERTIES} from './dom.ts';
it('normalizes a fixed-position card without reparenting it or shrinking its host',async()=>{
 const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:800,height:600}});
 try {
  await page.evaluate('globalThis.__name=f=>f');
  await page.setContent('<style>body{margin:0}#foundation-root{width:100vw;height:100vh}#card{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:200px;height:100px}</style><div id="foundation-root"><section id="card">Code card</section></div>');
  const audit=await preserveCodeContext(page,'#card',STYLE_PROPERTIES);
  expect(audit.styleChanges).toHaveLength(0);expect(audit.geometryChanges).toHaveLength(0);
  expect(audit.fixtureHost.frame.slice(2)).toEqual([800,600]);
  expect((await page.locator('#card').boundingBox())?.x).toBeCloseTo(0);
 } finally {await browser.close();}
});
it('preserves a focused input and scroll position while adding the isolation wrapper',async()=>{
 const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:800,height:600}});
 try {
  await page.evaluate('globalThis.__name=f=>f');
  await page.setContent('<style>#foundation-root{width:800px;height:600px}#card{width:200px;height:100px;overflow:auto}input{border:1px solid gray}input:focus{border-color:blue}</style><div id="foundation-root"><section id="card"><input><div style="height:500px">Content</div></section></div>');
  await page.locator('input').focus();await page.locator('#card').evaluate(el=>el.scrollTop=10);
  const audit=await preserveCodeContext(page,'#card',STYLE_PROPERTIES);
  expect(audit.focusRestored).toBe(true);expect(audit.styleChanges).toHaveLength(0);
  expect(await page.locator('input').evaluate(el=>document.activeElement===el)).toBe(true);
  expect(await page.locator('#card').evaluate(el=>el.scrollTop)).toBe(10);
 } finally {await browser.close();}
});
it('does not turn fixture-root overflow into a zero-area clip on the synthetic wrapper',async()=>{
 const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:400,height:300}});
 try {
  await page.evaluate('globalThis.__name=f=>f');
  await page.setContent('<style>#foundation-root{width:400px;height:300px;overflow:hidden}</style><div id="foundation-root"><section id="card" style="width:200px;height:100px"><button>Keep visible</button></section></div>');
  await preserveCodeContext(page,'#card',STYLE_PROPERTIES);
  expect(await page.locator('#foundation-root').evaluate(el=>getComputedStyle(el).overflow)).toBe('visible');
 } finally {await browser.close();}
});
