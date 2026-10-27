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
 expect(await page.locator('#foundation-root').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(12, 34, 56)')
})
it('fails closed if assigning the capture id changes authored selectors',async()=>{
 await page.setContent('<style>#selected{color:red}</style><div><span id="selected">Native</span></div>')
 await expect(preserveDesignContext(page,'#selected',STYLE_PROPERTIES)).rejects.toThrow('Design context changed')
})
