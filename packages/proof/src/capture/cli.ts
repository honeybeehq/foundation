import {captureFrames} from './frame.ts'
import {preserveDesignContext} from './design-context.ts'
import { captureFullExtent } from "./extent.ts";
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve, join, relative } from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseDocument, bakeDocument, loadChain } from '../../../engine/src/index.js'
import { getBrowser, closeBrowser, DETERMINISM_FLAGS } from '../../../engine/src/render/browser.js'
import { collectDom, STYLE_PROPERTIES } from './dom.js'
import { startCodeServer } from './vite.js'
import type { Links } from './types.js'
import { writePair, writeGallery } from './gallery.js'
import { pinFontStacks, usedFonts } from './fonts.js'
import {rendererSources} from './provenance.js'
import {settleRoot} from './settle.js'

const args = process.argv.slice(2)
const option = (key: string, fallback?: string) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback
const repo = resolve(option('--code', '.')!)
const linksPath = resolve(repo, option('--links', '.foundation/links.json')!)
const out = resolve(option('--out', 'captures')!)
const designPath = resolve(option('--design', resolve(import.meta.dirname, '../../fixtures/design/tracks-pane.fdn.html'))!)
const codeBoundary = option('--code-boundary')
const preserveContext = args.includes('--preserve-design-context')
if (preserveContext && codeBoundary) throw Error('Choose design-context preservation or legacy card extraction, not both')
const started = performance.now()
const links = JSON.parse(await readFile(linksPath, 'utf8')) as Links
if (links.schema !== 'fdn-links/0' || !links.artboards?.length) throw new Error('Expected fdn-links/0 with artboards')
const source = await readFile(designPath, 'utf8')
const htmlSha256 = createHash('sha256').update(source).digest('hex')
const { doc } = parseDocument(source)
const chainBytes = await readFile(`${designPath}.chain`)
const designHead = links.binding === 'chain-sha256' ? createHash('sha256').update(chainBytes).digest('hex') : loadChain(chainBytes).head().hash
if (links.designHead && links.designHead !== designHead) throw new Error('Linked design head differs from design sidecar')
const fontAssets = await Promise.all((links.fonts ?? []).map(async font => {
  const bytes = await readFile(resolve(repo, font.path))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (font.sha256 && font.sha256 !== sha256) throw new Error(`Font asset hash mismatch: ${font.path}`)
  return { ...font, sha256, css: `@font-face{font-family:${JSON.stringify(font.family)};font-weight:${font.weight};font-style:normal;src:url(data:font/${font.format === 'truetype' ? 'ttf' : 'woff2'};base64,${bytes.toString('base64')}) format('${font.format ?? 'woff2'}')}` }
}))
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim()
if (dirty && !args.includes('--allow-dirty')) throw new Error('Code checkout is dirty; commit it or use --allow-dirty for exploratory captures')
const rendererRepo = resolve(import.meta.dirname, '../../../..')
const rendererCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: rendererRepo, encoding:'utf8'}).trim()
const rendererDirty = Boolean(execFileSync('git', ['status', '--porcelain', '--', 'packages/engine', 'packages/proof/src', 'package.json', 'pnpm-lock.yaml'], {cwd: rendererRepo, encoding:'utf8'}).trim())
const provenance = await rendererSources(rendererRepo)
const target = await startCodeServer(repo, links)
const browser = await getBrowser()
try {
if (links.browserVersion && browser.version() !== links.browserVersion) throw new Error(`Browser mismatch: expected ${links.browserVersion}, got ${browser.version()}`)
if (links.platform && process.platform !== links.platform) throw new Error(`Platform mismatch: expected ${links.platform}, got ${process.platform}`)
  let index = 0
  const pairs: {path: string; state: string}[] = []
  for (const { board, state } of target.entries) {
    const pairStart = performance.now()
    let frame = {width: board.viewport.width, height: board.viewport.height}
    const folder = join(out, board.id, state.name, `${board.viewport.width}x${board.viewport.height}@${board.viewport.dpr}`)
    for (const side of ['design', 'code'] as const) {
      const captureStart = performance.now()
      const blocked: string[] = []
      const errors: string[] = []
      const context = await browser.newContext({ viewport: { width: board.viewport.width, height: board.viewport.height }, deviceScaleFactor: board.viewport.dpr, colorScheme: 'light', reducedMotion: 'reduce', forcedColors: 'none', timezoneId: 'UTC', locale: 'en-US', serviceWorkers: 'block' })
      await context.addInitScript(() => {
        ;(window as any).__name = (fn: unknown) => fn
        const pending = new Set<number>()
        const nativeSetTimeout = window.setTimeout.bind(window)
        const nativeClearTimeout = window.clearTimeout.bind(window)
        window.setTimeout = ((callback: any, delay?: number, ...params: any[]) => {
          const id = nativeSetTimeout(() => { pending.delete(id); callback(...params) }, delay)
          pending.add(id)
          return id
        }) as typeof window.setTimeout
        window.clearTimeout = id => { pending.delete(Number(id)); nativeClearTimeout(id) }
        Object.defineProperty(window, '__foundationPendingTimers', {get: () => pending.size})
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
      let designIsolation: Awaited<ReturnType<typeof preserveDesignContext>> | undefined
      let originalFontSubstitutions: Awaited<ReturnType<typeof pinFontStacks>> | undefined
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
          if (preserveContext) {
            await page.addStyleTag({content:fontAssets.map(font=>font.css).join('\n')+'\n*{animation:none!important;transition:none!important;caret-color:transparent!important}'})
            originalFontSubstitutions = await pinFontStacks(page,links.fontPolicy,'body')
            designIsolation = await preserveDesignContext(page,`[data-fdn-id="${state.designNode ?? board.designNode}"]`,STYLE_PROPERTIES)
          } else await page.evaluate(({id,properties,audit}) => {
            const selected = document.querySelector(`[data-fdn-id="${id}"]`)
            if (!selected) throw new Error(`Design node missing: ${id}`)
            const elements = [selected, ...selected.querySelectorAll('*')]
            const before = audit ? elements.map(el => properties.map(p => getComputedStyle(el).getPropertyValue(p))) : []
            const root = document.createElement('div')
            root.id = 'foundation-root'
            root.append(selected)
            document.body.replaceChildren(root)
            document.body.style.margin = '0'
            if (audit) {
              const differences = elements.flatMap((el,i) => properties.flatMap((property,j) => { const after=getComputedStyle(el).getPropertyValue(property); return before[i]![j] === after ? [] : [{node:i,property,before:before[i]![j],after}] }))
              ;(window as any).__foundationDesignExtraction = {nodes:elements.length,properties:properties.length,differences}
            }
          }, {id:state.designNode ?? board.designNode,properties:[...STYLE_PROPERTIES],audit:Boolean(codeBoundary)})
        }
        if (codeBoundary) await page.evaluate(({side, selector, properties}) => {
          const root = document.querySelector('#foundation-root')!
          const selected = side === 'code' ? root.querySelector(selector) : root.firstElementChild
          if (!(selected instanceof HTMLElement)) throw new Error(`Missing capture boundary: ${selector}`)
          const elements = [selected, ...selected.querySelectorAll('*')]
          const before = elements.map(el => properties.map(p => getComputedStyle(el).getPropertyValue(p)))
          const {width, height} = selected.getBoundingClientRect()
          const css = getComputedStyle(selected)
          const horizontal = css.boxSizing === 'border-box' ? 0 : ['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth'].reduce((sum,key) => sum + parseFloat(css[key as keyof CSSStyleDeclaration] as string || '0'), 0)
          const vertical = css.boxSizing === 'border-box' ? 0 : ['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth'].reduce((sum,key) => sum + parseFloat(css[key as keyof CSSStyleDeclaration] as string || '0'), 0)
          const focused = selected.contains(document.activeElement) ? document.activeElement as HTMLElement : null
          const scrolls = [selected, ...selected.querySelectorAll('*')].map(el => ({el, x:el.scrollLeft, y:el.scrollTop}))
          root.replaceChildren(selected)
          Object.assign(selected.style, {position:'relative', inset:'auto', left:'0px', top:'0px', margin:'0px', width:`${width-horizontal}px`, height:`${height-vertical}px`})
          focused?.focus({preventScroll:true})
          for (const {el,x,y} of scrolls) { el.scrollLeft=x; el.scrollTop=y }
          const after = selected.getBoundingClientRect()
          if (Math.abs(after.width-width)>0.05 || Math.abs(after.height-height)>0.05) throw new Error('Capture boundary size changed during extraction')
                  const differences = elements.flatMap((el,i) => properties.flatMap((property,j) => { const after=getComputedStyle(el).getPropertyValue(property); return before[i]![j] === after ? [] : [{node:i,property,before:before[i]![j],after}] }))
          const allowed = new Set(['position','margin-top','margin-right','margin-bottom','margin-left'])
          const unexpected = differences.filter(d => d.node !== 0 || !allowed.has(d.property))
          ;(window as any).__foundationBoundaryAudit = {nodes:elements.length,properties:properties.length,differences,unexpected,scrolls:scrolls.flatMap(({el,x,y},i) => x || y ? [{node:i,x,y}] : []),designExtraction:(window as any).__foundationDesignExtraction}
          if (unexpected.length || (window as any).__foundationDesignExtraction?.differences.length) throw new Error('Computed styles changed during boundary extraction: '+JSON.stringify(unexpected))
        }, {side, selector:codeBoundary,properties:[...STYLE_PROPERTIES]})
        const rootLayout = preserveContext && side === 'design' ? '' : '#foundation-root{width:100vw;height:100vh;overflow:hidden}'
        await page.addStyleTag({ content: fontAssets.map(font => font.css).join('\n') + '\n*{animation:none!important;transition:none!important;caret-color:transparent!important} ' + rootLayout })
        await page.evaluate(() => document.fonts.ready)
        const fontSubstitutions = originalFontSubstitutions ?? await pinFontStacks(page, links.fontPolicy)
        if (side === 'design') frame = await page.evaluate(() => {
          const root=document.querySelector('#foundation-root')!
          const rect = root.firstElementChild!.getBoundingClientRect()
          return {width: rect.width, height: rect.height}
        })
        const {hostFrame}=captureFrames(frame,board.viewport,preserveContext && side === 'code')
        if (!(preserveContext && side === 'design')) await page.addStyleTag({content: `#foundation-root{width:${hostFrame.width}px;height:${hostFrame.height}px}`})
        await page.waitForFunction(() => (window as any).__foundationPendingTimers === 0, undefined, {timeout:5000})
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        await settleRoot(page)
        const platformFonts = await usedFonts(page, links.fontPolicy?.requireCustomFonts ?? false, fontAssets.map(font => font.postScriptName).filter((name): name is string => Boolean(name)))
        const boundaryAudit = codeBoundary ? await page.evaluate(() => {
          const audit = (window as any).__foundationBoundaryAudit
          const elements = [document.querySelector('#foundation-root')!.firstElementChild!, ...document.querySelector('#foundation-root')!.firstElementChild!.querySelectorAll('*')]
          return {...audit, finalScrolls:audit.scrolls.map((s:any) => ({...s,finalX:elements[s.node]!.scrollLeft,finalY:elements[s.node]!.scrollTop}))}
        }) : undefined
        const dom = await collectDom(page, '#foundation-root')
        if (designIsolation) dom.extent.frame=[0,0,frame.width,frame.height]
        if (errors.length || blocked.length) throw new Error(JSON.stringify({ errors, blocked }))
        const fonts = await page.evaluate(() => [...new Set(Array.from(document.querySelectorAll('#foundation-root *')).map(el => getComputedStyle(el).fontFamily))].sort())
        const tokens = await page.evaluate(() => { const css = getComputedStyle(document.documentElement); return Object.fromEntries(Array.from(css).filter(k => k.startsWith('--')).sort().map(k => [k, css.getPropertyValue(k).trim()])) })
        const destination = join(folder, side)
        await mkdir(destination, { recursive: true })
        await page.screenshot({ path: join(destination, 'screenshot.png'), animations: 'disabled' })
        const fullExtent = await captureFullExtent(page, '#foundation-root', join(destination, 'full-extent.png'))
        await writeFile(join(destination, 'dom.json'), JSON.stringify(dom, null, 2) + '\n')
        const meta = { schema: 'fdn-capture/0', ...provenance, rendererCommit, rendererDirty, provable: state.provable !== false, ...(state.reason ? {reason: state.reason} : {}), source: side, artboard: board.id, state: state.name, viewport: board.viewport, extent: dom.extent, fullExtent, frame, ...(designIsolation ? {designIsolation} : {}), ...(preserveContext && side === 'code' ? {componentFrame:'unconstrained-host'} : {}), ...(codeBoundary ? {boundary:{codeSelector:codeBoundary, originNormalized:true, bothRootsNormalized:true, sizePreserved:true,audit:boundaryAudit}} : {}), url, fonts, fontPolicy: links.fontPolicy, fontSubstitutions, platformFonts, fontAssets: fontAssets.map(({css, ...font}) => font), tokens, renderedAt: '2026-07-31T12:00:00.000Z', ...(side === 'code' ? { repo: 'honeybeehq/apiary', commit, dirty: Boolean(dirty), root: board.component } : { file: links.designFile, htmlSha256, designHead, binding: links.binding ?? 'chain-head' }), browserVersion: browser.version(), platform: process.platform, flags: DETERMINISM_FLAGS, styleProperties: STYLE_PROPERTIES, blocked, errors, timingsMs: { capture: Math.round(performance.now() - captureStart) } }
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
} finally { await target.close(); await closeBrowser() }
console.log(`Captured ${target.entries.length} pairs in ${Math.round(performance.now() - started)} ms`)
