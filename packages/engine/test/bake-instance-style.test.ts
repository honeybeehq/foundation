import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { afterAll, describe, expect, it } from 'vitest'
import { bakeDocument, bakeEditorDocument } from '../src/index.js'
import { closeBrowser } from '../src/render/browser.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderDocument, renderHtml } from '../src/render/index.js'
import { parseDocument } from '../src/index.js'
import type { FdnDocument, FdnNode } from '../src/index.js'

const el = (id: string, tag: string, extra: Partial<FdnNode> = {}): FdnNode => ({ id, tag, attrs: {}, style: {}, styleStates: {}, children: [], ...extra })
const use = (id: string, component: string, extra: Partial<FdnNode> = {}): FdnNode => el(id, 'fdn-use', { ...extra, attrs: { component, ...(extra.attrs ?? {}) } })
const styled: Partial<FdnNode> = { styleRef: 'card', style: { width: '200px', 'flex-grow': '1' }, styleStates: { hover: { 'background-color': 'yellow' } } }

const doc: FdnDocument = {
  specVersion: '0.0.1-draft',
  tokens: {},
  params: [],
  data: [],
  lookups: [],
  states: [],
  viewports: [],
  matrix: [],
  namedStyles: [{ name: 'card', style: { 'padding-top': '4px' }, styleStates: { hover: { color: 'blue' } } }],
  components: [
    { name: 'Chip', props: [], slots: [], body: [el('c1', 'span', { style: { color: 'red', width: '10px' }, styleStates: { hover: { color: 'green' } }, text: 'chip' })] },
    { name: 'Pair', props: [], slots: [], body: [el('p1', 'i', { text: 'a' }), el('p2', 'i', { text: 'b' })] },
    { name: 'Nothing', props: [], slots: [], body: [el('e1', 'b', { when: 'false', text: 'never' })] },
    { name: 'Nested', props: [], slots: [], body: [use('m1', 'Chip')] },
    { name: 'Boxed', props: [], slots: [], body: [], sealed: { html: '<em>sealed</em>', css: 'em { color: teal; }' } },
  ],
  body: [
    el('row', 'div', {
      style: { display: 'flex', width: '600px' },
      children: [use('n1', 'Chip', styled), use('n2', 'Chip'), use('n3', 'Pair', { style: { width: '50px' } }), use('n4', 'Boxed', styled), use('n5', 'Nothing', { style: { width: '5px' } }), use('n6', 'Nested', { style: { margin: '0px' } })],
    }),
  ],
  annotations: [],
}

describe('instance styles', () => {
  const normal = bakeDocument(doc)
  const editor = bakeEditorDocument(doc)

  it('merges the instance style, named style and state planes onto the root, instance winning per property', () => {
    expect(normal.html).toContain(
      '<fdn-use component="Chip" style="display:contents">\n    <span style-hover="background-color:yellow;color:blue" style="color:red;flex-grow:1;padding-top:4px;width:200px">chip</span>\n  </fdn-use>',
    )
  })

  it('gives every instance wrapper display:contents, styled or not, and leaves an unstyled root as authored', () => {
    expect(normal.html).toContain('<fdn-use component="Chip" style="display:contents">\n    <span style-hover="color:green" style="color:red;width:10px">chip</span>\n  </fdn-use>')
  })

  it('applies to every root of a multi-root component and reports it', () => {
    expect(normal.html).toContain('<i style="width:50px">a</i>')
    expect(normal.html).toContain('<i style="width:50px">b</i>')
    expect(normal.report.lines).toContainEqual(expect.objectContaining({ code: 'instance-style-multi-root', nodeId: 'n3', detail: { roots: 2 } }))
  })

  it('applies to the capsule wrapper of a sealed component', () => {
    expect(normal.html).toContain('<div class="fdn-capsule-Boxed" style-hover="background-color:yellow;color:blue" style="flex-grow:1;padding-top:4px;width:200px">')
  })

  it('reports a style that has no element to land on', () => {
    expect(normal.report.lines).toContainEqual(expect.objectContaining({ code: 'instance-style-unapplied', nodeId: 'n5' }))
  })

  it('passes through a nested instance root to its own root', () => {
    expect(normal.html).toMatch(/<fdn-use component="Nested" style="display:contents">\s*<fdn-use component="Chip" style="display:contents">\s*<span style-hover="color:green" style="color:red;margin:0px;width:10px">/)
  })

  it('does the same in the editor bake, keeping editor ids', () => {
    expect(editor.html).toContain('<fdn-use component="Chip" data-fdn-component="Chip" data-fdn-id="n1" style="display:contents">')
    expect(editor.html).toContain('<span data-fdn-id="n1::c1" style-hover="background-color:yellow;color:blue" style="color:red;flex-grow:1;padding-top:4px;width:200px">chip</span>')
    expect(editor.html).toContain('<div class="fdn-capsule-Boxed" data-fdn-component="Boxed" data-fdn-id="n4" style-hover="background-color:yellow;color:blue" style="flex-grow:1;padding-top:4px;width:200px">')
  })
})

function chromiumAvailable(): boolean {
  try {
    return existsSync(chromium.executablePath())
  } catch {
    return false
  }
}

describe.skipIf(!chromiumAvailable())('instance styles in a browser', () => {
  afterAll(async () => {
    await closeBrowser()
  })

  it('lets flex and align-self on an instance act on the parent layout', async () => {
    const layoutDoc: FdnDocument = {
      ...doc,
      body: [
        el('row', 'div', {
          style: { display: 'flex', width: '600px', height: '100px', 'align-items': 'flex-start' },
          children: [use('n1', 'Chip', { style: { 'flex-grow': '1', 'align-self': 'flex-end' } }), el('fixed', 'div', { attrs: { id: 'fixed' }, style: { width: '100px', height: '10px' } })],
        }),
      ],
      components: [{ name: 'Chip', props: [], slots: [], body: [el('c1', 'span', { attrs: { id: 'chip' }, style: { height: '10px' } })] }],
    }
    const { layout } = await renderHtml(bakeDocument(layoutDoc).html, { viewport: { name: 'v', width: 800, height: 200 } })
    const chip = layout.find((entry) => entry.id === 'chip')
    const fixed = layout.find((entry) => entry.id === 'fixed')
    expect(chip?.width).toBe(500)
    expect((chip?.y ?? 0) - (fixed?.y ?? 0)).toBe(90)
  })

  const board = (name: string): FdnDocument =>
    parseDocument(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'boards', `${name}.fdn.html`), 'utf8')).doc

  it('renders tracks-pane StatusDots as 7x7 dots in their flex rows', async () => {
    const [cell] = await renderDocument(board('tracks-pane'))
    const dots = (cell?.layout ?? []).filter((entry) => entry.id.endsWith('::n25'))
    expect(dots.length).toBeGreaterThan(0)
    for (const dot of dots) expect([dot.width, dot.height]).toEqual([7, 7])
  })

  it('lets the GuideNav spacer push the help-center footer links to the bottom of the sidebar', async () => {
    const [cell] = await renderDocument(board('system-help-center'))
    const box = (id: string) => (cell?.layout ?? []).find((entry) => entry.id === id)
    const sidebar = box('n217::n16')
    const spacer = box('n217::n25')
    const lastLink = (cell?.layout ?? []).filter((entry) => entry.id.startsWith('n217::') && entry.y > (spacer?.y ?? 0)).at(-1)
    expect(spacer?.height).toBeGreaterThan(100)
    expect((sidebar?.y ?? 0) + (sidebar?.height ?? 0) - ((lastLink?.y ?? 0) + (lastLink?.height ?? 0))).toBeLessThan(24)
  })
})
