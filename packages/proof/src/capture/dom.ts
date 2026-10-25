import type { Page } from 'playwright'

import { properties } from '../compare/style.js'

export const STYLE_PROPERTIES = properties

export async function collectDom(page: Page, root: string) {
  return page.evaluate(({ root, properties }) => {
    const element = document.querySelector(root)
    if (!element) throw new Error(`Capture root missing: ${root}`)
    const origin = element.getBoundingClientRect()
    const nodes: object[] = []
    const paths = new Map<Element, string>()
    const visibility = (el: Element, rect: DOMRect, css: CSSStyleDeclaration) => {
      let transparent = false
      const clips: {path: string; box: number[]; x: boolean; y: boolean; scrollX: boolean; scrollY: boolean; pan: boolean}[] = []
      for (let parent = el.parentElement; parent && element.contains(parent); parent = parent.parentElement) {
        const s = getComputedStyle(parent), r = parent.getBoundingClientRect()
        if (Number(s.opacity) === 0) transparent = true
        const pan = s.overflow === 'hidden' && (s.touchAction === 'none' || parent.getAttribute('role') === 'application') && Array.from(parent.children).some(c => getComputedStyle(c).transform !== 'none')
        const x = /^(hidden|clip|auto|scroll)$/.test(s.overflowX)
        const y = /^(hidden|clip|auto|scroll)$/.test(s.overflowY)
        if (x || y) clips.push({path: paths.get(parent)!, box: [r.x - origin.x + parent.clientLeft, r.y - origin.y + parent.clientTop, parent.clientWidth, parent.clientHeight], x, y,
          pan, scrollX: /^(auto|scroll)$/.test(s.overflowX) && parent.scrollWidth > parent.clientWidth + 1,
          scrollY: /^(auto|scroll)$/.test(s.overflowY) && parent.scrollHeight > parent.clientHeight + 1})
      }
      const text = Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
      const interactive = el.matches('button,input,select,textarea,a[href],[tabindex],[contenteditable]:not([contenteditable="false"]),summary,[role="button"],[role="link"],[role="textbox"],[role="checkbox"],[role="radio"],[role="switch"],[role="combobox"],[role="slider"],[role="spinbutton"],[role="menuitem"],[role="option"],[role="tab"]')
      return {interactive, eligible: (text || interactive) && !transparent && css.visibility === 'visible' && Number(css.opacity) > 0 && rect.width > 0 && rect.height > 0, clips}
    }
    const visit = (el: Element, path: string) => {
      paths.set(el, path)
      const css = getComputedStyle(el)
      if (css.display === 'none' || ['SCRIPT', 'STYLE', 'LINK'].includes(el.tagName)) return
      const rect = el.getBoundingClientRect()
      const vars = Object.fromEntries(Array.from(css).filter(key => key.startsWith('--')).sort().map(key => [key, css.getPropertyValue(key).trim()]))
      const labelled = el.getAttribute('aria-labelledby')?.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim()
      const text = Array.from(el.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim()
      const paint = {transform:css.transform, fill:css.fill, stroke:css.stroke, strokeWidth:css.strokeWidth, filter:css.filter, clipPath:css.clipPath, ...(el.namespaceURI === 'http://www.w3.org/2000/svg' ? {attributes:Object.fromEntries(el.getAttributeNames().filter(key => key !== 'class' && key !== 'style').sort().map(key => [key,el.getAttribute(key)]))} : {})}
      const authoredFontFamily = (window as any).__foundationAuthoredFontFamilies?.get(el)
      nodes.push({ visibility: visibility(el, rect, css), path, ...(authoredFontFamily ? {authoredFontFamily} : {}), tag: el.tagName.toLowerCase(), fdnId: el.getAttribute('data-fdn-id'), role: el.getAttribute('role') ?? ({ BUTTON: 'button', INPUT: 'textbox', IMG: 'img', A: 'link' }[el.tagName] ?? ''), name: el.getAttribute('aria-label') ?? labelled ?? el.getAttribute('alt') ?? text, text, box: [rect.x - origin.x, rect.y - origin.y, rect.width, rect.height], style: Object.fromEntries(properties.map(key => [key, css.getPropertyValue(key)])), vars, paint })
      Array.from(el.children).forEach((child, i) => visit(child, `${path}/${i}`))
    }
    visit(element, '0')
    return { root, nodes, extent: {frame: [0, 0, origin.width, origin.height], scroll: [element.scrollWidth, element.scrollHeight], viewport: [-origin.x, -origin.y, innerWidth, innerHeight]} }
  }, { root, properties: [...STYLE_PROPERTIES] })
}
