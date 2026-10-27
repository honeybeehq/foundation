import type { Page } from 'playwright'
import type { Links } from './types.js'

export async function pinFontStacks(page: Page, policy: Links['fontPolicy'], root = '#foundation-root') {
  if (!policy) return []
  const substitutions = await page.evaluate(({policy,root}) => {
    const authored = new WeakMap<Element,string>()
    ;(window as any).__foundationAuthoredFontFamilies = authored
    const replacements = new Map<string, string>()
    const rows = Array.from(document.querySelectorAll<HTMLElement>(`${root}, ${root} *`)).map(el => ({el, family: getComputedStyle(el).fontFamily}))
    for (const {el, family} of rows) {
      authored.set(el, family)
      const names = family.split(',').map(value => value.trim().replace(/^['"]|['"]$/g, ''))
      const normalized = [...new Set(names.map(name => {
        if (/^(ui-monospace|monospace|SF Mono|Menlo|Monaco|Consolas|Courier New)$/i.test(name)) return policy.mono
        if (/^(-apple-system|BlinkMacSystemFont|system-ui|sans-serif|Helvetica Neue|Helvetica|Arial|Segoe UI)$/i.test(name)) return policy.sans
        if (/^(serif|Times New Roman|Times)$/i.test(name)) return policy.serif
        return name
      }).concat(policy.fallback))].map(name => JSON.stringify(name)).join(', ')
      el.style.fontFamily = normalized
      replacements.set(family, normalized)
    }
    document.body.getBoundingClientRect()
    return [...replacements].sort(([a], [b]) => a.localeCompare(b)).map(([from, to]) => ({from, to}))
  }, {policy,root})
  await page.evaluate(() => document.fonts.ready)
  return substitutions
}

export async function usedFonts(page: Page, requireCustom: boolean, allowed: string[]) {
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const {root} = await cdp.send('DOM.getDocument')
    const {nodeIds} = await cdp.send('DOM.querySelectorAll', {nodeId:root.nodeId, selector:'#foundation-root, #foundation-root *'})
    const fonts = new Map<string, {familyName:string;postScriptName:string;isCustomFont:boolean;glyphCount:number}>()
    for (const nodeId of nodeIds) {
      const result = await cdp.send('CSS.getPlatformFontsForNode', {nodeId})
      for (const font of result.fonts) if (font.glyphCount) {
        const key = `${font.postScriptName}:${font.isCustomFont}`
        const previous = fonts.get(key)
        fonts.set(key, {...font, glyphCount:(previous?.glyphCount ?? 0) + font.glyphCount})
      }
    }
    const result = [...fonts.values()].sort((a,b) => a.postScriptName.localeCompare(b.postScriptName))
    const system = result.filter(font => !font.isCustomFont)
    if (requireCustom && result.some(font => !allowed.includes(font.postScriptName))) throw new Error(`Undeclared font rendered glyphs: ${result.filter(font => !allowed.includes(font.postScriptName)).map(font => font.postScriptName).join(", ")}`)
    if (requireCustom && system.length) throw new Error(`Unbundled fonts rendered glyphs: ${system.map(font => font.postScriptName).join(', ')}`)
    return result
  } finally { await cdp.detach() }
}
