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
    if (document.getElementById('foundation-root')) throw Error('Capture root already exists')
    if (getComputedStyle(document.documentElement).transform !== 'none') throw Error('Authored html transforms need a dedicated capture adapter')
    const focused=selected.contains(document.activeElement) ? document.activeElement as HTMLElement : null
    const scrolls=elements.map(el=>({el,x:el.scrollLeft,y:el.scrollTop}))
    const originalId = selected.id
    const wrapper=document.createElement('div')
    wrapper.id='foundation-root'
    wrapper.style.display='contents'
    wrapper.style.overflow='visible'
    selected.before(wrapper)
    wrapper.append(selected)
    focused?.focus({preventScroll:true})
    for(const {el,x,y} of scrolls) {el.scrollLeft=x;el.scrollTop=y}
    if(focused && document.activeElement!==focused) throw Error('Capture context lost focused element')
    const isolation = document.createElement('style')
    isolation.textContent = `html{transform:translate(${-original.x}px,${-original.y}px)!important;transform-origin:0 0!important}body *:not(#foundation-root):not(#foundation-root *){visibility:hidden!important}#foundation-root{visibility:visible!important}`
    document.head.append(isolation)
    const after = selected.getBoundingClientRect()
    const geometryChanges = elements.flatMap((el,i) => {
      const r=el.getBoundingClientRect(), actual=[r.x-after.x,r.y-after.y,r.width,r.height]
      const empty = boxes[i]![2] === 0 && boxes[i]![3] === 0 && actual[2] === 0 && actual[3] === 0
      return actual.some((v,j)=>(j>=2 || !empty) && Math.abs(v-boxes[i]![j]!)>0.05)?[{node:i,before:boxes[i],after:actual}]:[]
    })
    const styleChanges = elements.flatMap((el,i) => properties.flatMap((property,j) => {
      const actual=getComputedStyle(el).getPropertyValue(property)
      return actual===styles[i]![j]?[]:[{node:i,property,before:styles[i]![j],after:actual}]
    }))
    if (geometryChanges.length || styleChanges.length || Math.abs(after.x)>0.05 || Math.abs(after.y)>0.05) throw Error('Design context changed during isolation: '+JSON.stringify({geometryChanges,styleChanges,origin:[after.x,after.y]}))
    return {mode:'in-place' as const,focusRestored:Boolean(focused),scrollPositionsPreserved:scrolls.length, originalId, originalBox:[original.x,original.y,original.width,original.height], isolatedBox:[after.x,after.y,after.width,after.height], properties:properties.length, nodes:elements.length,geometryChanges,styleChanges,wrapper:'display:contents',ancestorContextPreserved:true,outsidePaint:'visibility:hidden',backgrounds:'authored html/body retained',ancestorClips:'retained'}
  },{selector,properties:[...properties]})
}
