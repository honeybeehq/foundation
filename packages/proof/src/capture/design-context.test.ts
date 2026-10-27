import {afterAll,beforeAll,expect,it} from 'vitest'
import {chromium,type Browser,type Page} from 'playwright'
import {preserveDesignContext} from './design-context.ts'
import {STYLE_PROPERTIES} from './dom.ts'
let browser:Browser,page:Page
beforeAll(async()=>{browser=await chromium.launch();page=await browser.newPage({viewport:{width:240,height:100}});await page.evaluate('globalThis.__name = f => f')})
afterAll(async()=>{await browser?.close()})
it.each([
 ['dot','<span id="selected" style="height:6px;width:6px;background:green;flex:none"></span>'],
 ['button','<span id="selected" style="display:flex;border:1px solid;padding:0 12px;height:28px">retry fresh</span>'],
])('preserves the intrinsic %s geometry from a flex context',async(_name,child)=>{
 await page.setContent(`<style>body{margin:8px}.host{display:flex;gap:8px;width:200px;font:12px sans-serif}</style><div class="host">${child}<span>sibling</span></div>`)
 const result=await preserveDesignContext(page,'#selected',STYLE_PROPERTIES)
 expect(result.originalBox[2]).toBeGreaterThan(0)
 expect(result.isolatedBox.slice(2)).toEqual(result.originalBox.slice(2))
 expect(result.isolatedBox.slice(0,2)).toEqual([0,0])
})
it('retains inherited font and variable styles from real ancestors',async()=>{
 await page.setContent('<div class="host" style="display:flex;font:17px monospace;--ink:rgb(12, 34, 56)"><span id="selected" style="display:inline-flex;color:var(--ink)">Native</span></div>')
 const result=await preserveDesignContext(page,'#selected',STYLE_PROPERTIES)
 expect(result.styleChanges).toEqual([])
 expect(result.geometryChanges).toEqual([])
 expect(await page.locator('#foundation-root > #selected').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(12, 34, 56)')
})
it('fails closed if assigning the capture id changes authored selectors',async()=>{
 await page.setContent('<style>.host > #selected{color:red}</style><div class="host"><span id="selected">Native</span></div>')
 await expect(preserveDesignContext(page,'#selected',STYLE_PROPERTIES)).rejects.toThrow('Design context changed')
})
it('ignores meaningless positions of empty display-contents rectangles',async()=>{
 await page.setContent('<div style="display:flex;margin:25px"><div id="selected" style="display:flex"><span style="display:contents"><b>Content</b></span></div></div>')
 const result=await preserveDesignContext(page,'#selected',STYLE_PROPERTIES)
 expect(result.geometryChanges).toEqual([])
 expect(await page.locator('#foundation-root > #selected').count()).toBe(1)
})
it('keeps diagnostic overflow paint at the isolated origin',async()=>{
 const {captureFullExtent}=await import('./extent.ts')
 const {mkdtemp,readFile,rm}=await import('node:fs/promises')
 const {tmpdir}=await import('node:os')
 const {join}=await import('node:path')
 const {PNG}=await import('pngjs')
 const directory=await mkdtemp(join(tmpdir(),'foundation-context-'))
 try {
  await page.setContent('<div style="display:flex;margin:28px"><span id="selected" style="width:6px;height:6px;background:rgb(0,128,0);flex:none"></span></div>')
  await preserveDesignContext(page,'#selected',STYLE_PROPERTIES)
  const path=join(directory,'extent.png')
  await captureFullExtent(page,'#foundation-root',path)
  const png=PNG.sync.read(await readFile(path))
  expect([png.width,png.height]).toEqual([6,6])
  const i=(2*png.width+2)*4
  expect([...png.data.subarray(i,i+3)]).toEqual([0,128,0])
 } finally {await rm(directory,{recursive:true,force:true})}
})
it('keeps the reference frame for overflow detection inside a larger rendering host',async()=>{
 const {captureFrames}=await import('./frame.ts')
 const {offscreenDefects}=await import('../compare/offscreen.ts')
 const reference={width:20,height:20},viewport={width:100,height:100}
 const {frame,hostFrame}=captureFrames(reference,viewport,true)
 expect(frame).toEqual(reference)
 expect(hostFrame).toEqual(viewport)
 const node=(height:number)=>({path:'0/0',tag:'button',fdnId:'action',text:'Action',box:[0,0,20,height] as [number,number,number,number],style:{},visibility:{eligible:true,interactive:true,clips:[]}})
 const design={nodes:[node(20)],meta:{frame,viewport},screenshot:Buffer.alloc(0)}
 const code={nodes:[node(40)],meta:{frame,viewport},screenshot:Buffer.alloc(0)}
 expect(offscreenDefects(design,code,[]).some(d=>d.cause==='offscreen')).toBe(true)
})
it('keeps a wide board layout while clipping a small specimen screenshot',async()=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises')
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {PNG}=await import('pngjs')
 const directory=await mkdtemp(join(tmpdir(),'foundation-viewport-'))
 try {
  await page.setViewportSize({width:1600,height:1200})
  await page.setContent('<style>body{margin:0}.board{display:flex;width:80vw}.spacer{width:1100px;flex:none}#selected{font:11px monospace}</style><div class="board"><div class="spacer"></div><span id="selected">WHAT A ROW SAYS</span></div>')
  const result=await preserveDesignContext(page,'#selected',STYLE_PROPERTIES)
  const file=join(directory,'normal.png');await page.screenshot({path:file,clip:{x:0,y:0,width:240,height:60}})
  const png=PNG.sync.read(await readFile(file))
  expect([png.width,png.height]).toEqual([240,60]);expect(result.originalBox[3]).toBeLessThan(20)
  expect(await page.viewportSize()).toEqual({width:1600,height:1200})
 } finally {await page.setViewportSize({width:240,height:100});await rm(directory,{recursive:true,force:true})}
})
