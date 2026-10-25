import type { Page } from 'playwright'

import { properties } from '../compare/style.js'

export const STYLE_PROPERTIES = properties

export async function collectDom(page: Page, root: string) {
  return page.evaluate(({ root, properties }) => {
    const element = document.querySelector(root)
    if (!element) throw new Error(`Capture root missing: ${root}`)
    const origin = element.getBoundingClientRect()
    const nodes: object[] = []
    const visit = (el: Element, path: string) => {
      const css = getComputedStyle(el)
      if (css.display === 'none' || ['SCRIPT', 'STYLE', 'LINK'].includes(el.tagName)) return
      const rect = el.getBoundingClientRect()
      const vars = Object.fromEntries(Array.from(css).filter(key => key.startsWith('--')).sort().map(key => [key, css.getPropertyValue(key).trim()]))
      const labelled = el.getAttribute('aria-labelledby')?.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim()
      const text = Array.from(el.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim()
      const paint = {transform:css.transform, fill:css.fill, stroke:css.stroke, strokeWidth:css.strokeWidth, filter:css.filter, clipPath:css.clipPath, ...(el.namespaceURI === 'http://www.w3.org/2000/svg' ? {attributes:Object.fromEntries(el.getAttributeNames().filter(key => key !== 'class' && key !== 'style').sort().map(key => [key,el.getAttribute(key)]))} : {})}
      nodes.push({ path, tag: el.tagName.toLowerCase(), fdnId: el.getAttribute('data-fdn-id'), role: el.getAttribute('role') ?? ({ BUTTON: 'button', INPUT: 'textbox', IMG: 'img', A: 'link' }[el.tagName] ?? ''), name: el.getAttribute('aria-label') ?? labelled ?? el.getAttribute('alt') ?? text, text, box: [rect.x - origin.x, rect.y - origin.y, rect.width, rect.height], style: Object.fromEntries(properties.map(key => [key, css.getPropertyValue(key)])), vars, paint })
      Array.from(el.children).forEach((child, i) => visit(child, `${path}/${i}`))
    }
    visit(element, '0')
    return { root, nodes }
  }, { root, properties: [...STYLE_PROPERTIES] })
}
