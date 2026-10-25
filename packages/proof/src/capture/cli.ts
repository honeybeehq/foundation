import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve, join, relative } from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseDocument, bakeDocument } from '../../../engine/src/index.js'
import { getBrowser, closeBrowser, DETERMINISM_FLAGS } from '../../../engine/src/render/browser.js'
import { collectDom, STYLE_PROPERTIES } from './dom.js'
import { startCodeServer } from './vite.js'
import type { Links } from './types.js'
import { writePair, writeGallery } from './gallery.js'

const args = process.argv.slice(2)
const option = (key: string, fallback?: string) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback
const repo = resolve(option('--code', '.')!)
const linksPath = resolve(repo, option('--links', '.foundation/links.json')!)
const out = resolve(option('--out', 'captures')!)
const designPath = resolve(option('--design', resolve(import.meta.dirname, '../../fixtures/design/tracks-pane.fdn.html'))!)
const started = performance.now()
const links = JSON.parse(await readFile(linksPath, 'utf8')) as Links
if (links.schema !== 'fdn-links/0' || !links.artboards?.length) throw new Error('Expected fdn-links/0 with artboards')
const source = await readFile(designPath, 'utf8')
const htmlSha256 = createHash('sha256').update(source).digest('hex')
const { doc } = parseDocument(source)
const fontAssets = await Promise.all((links.fonts ?? []).map(async font => {
  const bytes = await readFile(resolve(repo, font.path))
  return { ...font, sha256: createHash('sha256').update(bytes).digest('hex'), css: `@font-face{font-family:${JSON.stringify(font.family)};font-weight:${font.weight};font-style:normal;src:url(data:font/woff2;base64,${bytes.toString('base64')}) format('woff2')}` }
}))
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim()
const target = await startCodeServer(repo, links)
const browser = await getBrowser()
try {
  let index = 0
  const pairs: {path: string; state: string}[] = []
  for (const { board, state } of target.entries) {
    const pairStart = performance.now()
    const folder = join(out, board.id, state.name, `${board.viewport.width}x${board.viewport.height}@${board.viewport.dpr}`)
    for (const side of ['design', 'code'] as const) {
      const captureStart = performance.now()
      const blocked: string[] = []
      const errors: string[] = []
      const context = await browser.newContext({ viewport: { width: board.viewport.width, height: board.viewport.height }, deviceScaleFactor: board.viewport.dpr, colorScheme: 'light', reducedMotion: 'reduce', forcedColors: 'none', timezoneId: 'UTC', locale: 'en-US', serviceWorkers: 'block' })
      await context.addInitScript(() => {
        ;(window as any).__name = (fn: unknown) => fn
        const epoch = Date.parse('2026-07-31T12:00:00Z')
        const RealDate = Date
        window.Date = new Proxy(RealDate, { construct: (target, args) => args.length ? Reflect.construct(target, args) : new target(epoch), apply: () => new RealDate(epoch).toString() })
        Date.now = () => epoch
        let seed = 1
        Math.random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 4294967296
        Object.defineProperty(performance, 'now', { value: () => 0, configurable: true })
        window.WebSocket = class { constructor() { throw new Error('Foundation: WebSocket blocked') } } as unknown as typeof WebSocket
      })
      await context.route('**/*', async route => {
        const req = route.request()
        const url = new URL(req.url())
        const asset = ['document', 'script', 'stylesheet', 'image', 'font', 'other'].includes(req.resourceType())
        if (url.origin === new URL(target.url).origin && req.method() === 'GET' && asset) await route.continue()
        else { blocked.push(req.url()); await route.abort('blockedbyclient') }
      })
      const page = await context.newPage()
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
      let url = 'foundation:baked'
      try {
        if (side === 'code') {
          url = `${target.url}__foundation/${index}`
          await page.goto(url)
          await page.waitForFunction(() => (window as any).__foundationReady || (window as any).__foundationError, { timeout: 60000 })
          const error = await page.evaluate(() => (window as any).__foundationError)
          if (error) throw new Error(error)
        } else {
          const baked = bakeDocument(doc, { state: state.designState, includeNodeIds: true })
          await page.setContent(baked.html)
          await page.evaluate(id => {
            const selected = document.querySelector(`[data-fdn-id="${id}"]`)
            if (!selected) throw new Error(`Design node missing: ${id}`)
            const root = document.createElement('div')
            root.id = 'foundation-root'
            root.append(selected)
            document.body.replaceChildren(root)
            document.body.style.margin = '0'
          }, state.designNode ?? board.designNode)
        }
        await page.addStyleTag({ content: fontAssets.map(font => font.css).join('\n') + '\n*{animation:none!important;transition:none!important;caret-color:transparent!important} #foundation-root{width:100vw;height:100vh;overflow:hidden}' })
        await page.evaluate(() => document.fonts.ready)
        const dom = await collectDom(page, '#foundation-root')
        if (errors.length || blocked.length) throw new Error(JSON.stringify({ errors, blocked }))
        const fonts = await page.evaluate(() => [...new Set(Array.from(document.querySelectorAll('#foundation-root *')).map(el => getComputedStyle(el).fontFamily))].sort())
        const tokens = await page.evaluate(() => { const css = getComputedStyle(document.documentElement); return Object.fromEntries(Array.from(css).filter(k => k.startsWith('--')).sort().map(k => [k, css.getPropertyValue(k).trim()])) })
        const destination = join(folder, side)
        await mkdir(destination, { recursive: true })
        await page.screenshot({ path: join(destination, 'screenshot.png'), animations: 'disabled' })
        await writeFile(join(destination, 'dom.json'), JSON.stringify(dom, null, 2) + '\n')
        const meta = { schema: 'fdn-capture/0', source: side, artboard: board.id, state: state.name, viewport: board.viewport, url, fonts, fontAssets: fontAssets.map(({css, ...font}) => font), tokens, renderedAt: '2026-07-31T12:00:00.000Z', ...(side === 'code' ? { repo: 'honeybeehq/apiary', commit, dirty: Boolean(dirty), root: board.component } : { file: links.designFile, htmlSha256, designHead: (links as any).designHead ?? htmlSha256 }), browserVersion: browser.version(), platform: process.platform, flags: DETERMINISM_FLAGS, styleProperties: STYLE_PROPERTIES, blocked, errors, timingsMs: { capture: Math.round(performance.now() - captureStart) } }
        await writeFile(join(destination, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
        console.log(`${board.id}/${state.name} ${side}: ${dom.nodes.length} nodes, ${meta.timingsMs.capture} ms`)
      } finally { await context.close() }
    }
    await writePair(folder)
    pairs.push({path: relative(out, folder), state: state.name})
    console.log(`PAIR ${folder} ${Math.round(performance.now() - pairStart)} ms`)
    index++
  }
  await writeGallery(out, pairs)
} finally { await target.server.close(); await closeBrowser() }
console.log(`Captured ${target.entries.length} pairs in ${Math.round(performance.now() - started)} ms`)
