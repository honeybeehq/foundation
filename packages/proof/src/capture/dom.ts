import type { Page } from 'playwright'

export const STYLE_PROPERTIES = [
  'display', 'visibility', 'position', 'box-sizing', 'overflow-x', 'overflow-y',
  'color', 'background-color', 'opacity', 'font-family', 'font-size', 'font-weight',
  'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-decoration-line',
  'white-space', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'border-top-width',
  'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-color',
  'border-right-color', 'border-bottom-color', 'border-left-color', 'border-top-style',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius',
  'border-bottom-right-radius', 'box-shadow', 'gap', 'row-gap', 'column-gap',
  'flex-direction', 'align-items', 'justify-content', 'flex-grow', 'flex-shrink',
  'background-image', 'text-shadow', 'text-transform', 'border-right-style',
  'border-bottom-style', 'border-left-style',
] as const

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
      nodes.push({ path, tag: el.tagName.toLowerCase(), fdnId: el.getAttribute('data-fdn-id'), role: el.getAttribute('role') ?? ({ BUTTON: 'button', INPUT: 'textbox', IMG: 'img', A: 'link' }[el.tagName] ?? ''), name: el.getAttribute('aria-label') ?? labelled ?? el.getAttribute('alt') ?? text, text, box: [rect.x - origin.x, rect.y - origin.y, rect.width, rect.height], style: Object.fromEntries(properties.map(key => [key, css.getPropertyValue(key)])), vars })
      Array.from(el.children).forEach((child, i) => visit(child, `${path}/${i}`))
    }
    visit(element, '0')
    return { root, nodes }
  }, { root, properties: [...STYLE_PROPERTIES] })
}
