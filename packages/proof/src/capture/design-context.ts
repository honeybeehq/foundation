import type {Page} from 'playwright'

export async function preserveDesignContext(page: Page, selector: string, properties: readonly string[]) {
  await page.evaluate(() => document.fonts.ready)
  return page.evaluate(({selector, properties}) => {
    const selected = document.querySelector<HTMLElement>(selector)
    if (!selected) throw Error(`Design node missing: ${selector}`)
    const elements = [selected, ...selected.querySelectorAll('*')]
    const original = selected.getBoundingClientRect()
    if (original.width <= 0 || original.height <= 0) throw Error('Selected design root has no painted size in its original context')
    const boxes = elements.map(el => {const r=el.getBoundingClientRect();return [r.x-original.x,r.y-original.y,r.width,r.height]})
    const styles = elements.map(el => properties.map(p => getComputedStyle(el).getPropertyValue(p)))
    const originalId = selected.id
    selected.id = 'foundation-root'
    const isolation = document.createElement('style')
    isolation.textContent = `html{translate:${-original.x}px ${-original.y}px!important}body *:not(#foundation-root):not(#foundation-root *){visibility:hidden!important}#foundation-root{visibility:visible!important}`
    document.head.append(isolation)
    const after = selected.getBoundingClientRect()
    const geometryChanges = elements.flatMap((el,i) => {
      const r=el.getBoundingClientRect(), actual=[r.x-after.x,r.y-after.y,r.width,r.height]
      return actual.some((v,j)=>Math.abs(v-boxes[i]![j]!)>0.05)?[{node:i,before:boxes[i],after:actual}]:[]
    })
    const styleChanges = elements.flatMap((el,i) => properties.flatMap((property,j) => {
      const actual=getComputedStyle(el).getPropertyValue(property)
      return actual===styles[i]![j]?[]:[{node:i,property,before:styles[i]![j],after:actual}]
    }))
    if (geometryChanges.length || styleChanges.length || Math.abs(after.x)>0.05 || Math.abs(after.y)>0.05) throw Error('Design context changed during isolation: '+JSON.stringify({geometryChanges,styleChanges,origin:[after.x,after.y]}))
    return {mode:'in-place' as const, originalId, originalBox:[original.x,original.y,original.width,original.height], isolatedBox:[after.x,after.y,after.width,after.height], properties:properties.length, nodes:elements.length,geometryChanges,styleChanges}
  },{selector,properties:[...properties]})
}
