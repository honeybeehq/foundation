import {it,expect} from 'vitest';
import {chromium} from 'playwright';
import {captureLayoutRegions} from './layout-regions.ts';
import {collectDom} from './dom.ts';
it('resolves paired region selectors and records missing markers explicitly',async()=>{
 const browser=await chromium.launch();const page=await browser.newPage();
 try {
  await page.evaluate('globalThis.__name = f => f');
  await page.setContent('<div id="foundation-root"><section data-fdn-id="list"><p>A</p><p>B</p></section></div>');
  const regions=[{id:'list',designNode:'list',codeSelector:'section',repeat:{designSelector:'p',codeSelector:'p'}}];
  expect(await captureLayoutRegions(page,'design',regions)).toEqual(await captureLayoutRegions(page,'code',regions));
  expect((await captureLayoutRegions(page,'code',[{...regions[0]!,codeSelector:'aside'}]))[0]?.root).toBe(null);
 } finally {await browser.close();}
});
it('does not insert whitespace between adjacent React-style text nodes',async()=>{
 const browser=await chromium.launch();const page=await browser.newPage();
 try {
  await page.evaluate('globalThis.__name = f => f');
  await page.setContent('<div id="foundation-root"><span></span></div>');
  await page.locator('span').evaluate(el=>el.append(document.createTextNode('2 change'),document.createTextNode('s')));
  const captured=await collectDom(page,'#foundation-root');
  expect((captured.nodes as {text:string}[]).find(n=>n.text)?.text).toBe('2 changes');
 } finally {await browser.close();}
});
