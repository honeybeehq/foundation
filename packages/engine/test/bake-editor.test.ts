import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bakeDocument, bakeEditorComponent, bakeEditorDocument, parseDocument } from '../src/index.js'
import type { FdnDocument, FdnNode } from '../src/index.js'

const el = (id: string, tag: string, extra: Partial<FdnNode> = {}): FdnNode => ({ id, tag, attrs: {}, style: {}, styleStates: {}, children: [], ...extra })

const doc: FdnDocument = {
  specVersion: '0.0.1-draft',
  title: 'Editor',
  tokens: { accent: '#B8860B' },
  params: [],
  data: [{ name: 'items', items: [{ name: 'a' }, { name: 'b' }] }],
  lookups: [],
  states: [],
  viewports: [],
  matrix: [],
  namedStyles: [],
  components: [
    {
      name: 'Badge',
      props: [{ name: 'label', type: 'string', default: 'Hi' }],
      slots: [],
      body: [el('b1', 'span', { text: '{{ prop.label }}' }), el('b2', 'ul', { children: [el('b3', 'li', { each: 'x in data.items', text: '{{ x.name }}' })] })],
    },
  ],
  body: [
    el('n1', 'div', {
      style: { color: 'var(--accent)' },
      styleStates: { hover: { color: 'red' } },
      children: [el('n2', 'fdn-use', { attrs: { component: 'Badge' } }), el('n3', 'p', { each: 'row in data.items', text: '{{ row.name }}' })],
    }),
  ],
  annotations: [],
}

describe('bakeEditorDocument', () => {
  const html = bakeEditorDocument(doc).html

  it('is a full document with the token block in the head', () => {
    expect(html.startsWith('<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>Editor</title>\n<style>\n:root {\n  --accent: #B8860B;\n}\n</style>\n</head>\n<body>\n')).toBe(true)
    expect(html.endsWith('</body>\n</html>\n')).toBe(true)
  })

  it('tags template nodes with their own id and keeps state planes', () => {
    expect(html).toContain('<div data-fdn-id="n1" style-hover="color:red" style="color:var(--accent)">')
  })

  it('tags component instances and their inner nodes', () => {
    expect(html).toContain('<fdn-use component="Badge" data-fdn-component="Badge" data-fdn-id="n2" data-fdn-prop-label="Hi">')
    expect(html).toContain('<span data-fdn-id="n2::b1">Hi</span>')
    expect(html).toContain('<ul data-fdn-id="n2::b2">')
    expect(html).toContain('<li data-fdn-id="n2::b3" data-fdn-index="0">a</li>')
    expect(html).toContain('<li data-fdn-id="n2::b3" data-fdn-index="1">b</li>')
  })

  it('keeps the template id on each repetitions and adds the index', () => {
    expect(html).toContain('<p data-fdn-id="n3" data-fdn-index="0">a</p>')
    expect(html).toContain('<p data-fdn-id="n3" data-fdn-index="1">b</p>')
  })

  it('renders the same elements as the normal bake once editor attributes are removed', () => {
    const body = html.slice(html.indexOf('<body>\n') + 7, html.indexOf('</body>'))
    const stripped = body.replace(/ data-fdn-(id|index|component)="[^"]*"/g, '')
    const normal = bakeDocument(doc).html
    expect(normal).not.toContain('data-fdn-id')
    expect(normal.endsWith(stripped)).toBe(true)
  })
})

describe('bakeEditorComponent', () => {
  it('bakes one component alone with default props, using the component name as the instance id', () => {
    const { html, report } = bakeEditorComponent(doc, 'Badge')
    expect(html).toContain('<fdn-use component="Badge" data-fdn-component="Badge" data-fdn-id="Badge" data-fdn-prop-label="Hi">')
    expect(html).toContain('<span data-fdn-id="Badge::b1">Hi</span>')
    expect(html).not.toContain('data-fdn-id="n1"')
    expect(report.lines.some((line) => line.code === 'unused-token')).toBe(false)
  })
})

describe('bakeEditorComponent sample props', () => {
  const board = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'boards', 'tracks-pane.fdn.html')
  const tracksPane = parseDocument(readFileSync(board, 'utf8')).doc
  const visibleText = (html: string): string =>
    html
      .slice(html.indexOf('<body>'))
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  it('fills props without defaults so ActionButton renders visible text, and marks the bake as a sample', () => {
    const { html, report } = bakeEditorComponent(tracksPane, 'ActionButton')
    expect(visibleText(html)).toBe('label hint')
    expect(html).toContain('data-fdn-sample="label,hint"')
    expect(html).toContain('data-fdn-prop-variant="default"')
    expect(report.lines).toContainEqual(expect.objectContaining({ code: 'sample-props', severity: 'info', detail: { props: { label: 'label', hint: 'hint' } } }))
  })

  it('samples each prop type and keeps declared defaults', () => {
    const sampleDoc: FdnDocument = {
      ...doc,
      components: [
        {
          name: 'Kinds',
          props: [
            { name: 'title', type: 'string' },
            { name: 'tone', type: 'enum', values: ['calm', 'loud'] },
            { name: 'on', type: 'boolean' },
            { name: 'count', type: 'number' },
            { name: 'rows', type: 'list', values: ['name'] },
            { name: 'bare', type: 'list' },
            { name: 'meta', type: 'record' },
            { name: 'kept', type: 'string', default: 'Kept' },
          ],
          slots: [],
          body: [el('k1', 'ul', { children: [el('k2', 'li', { each: 'r in prop.rows', text: '{{ r.name }}' })] })],
        },
      ],
    }
    const { html } = bakeEditorComponent(sampleDoc, 'Kinds')
    expect(html).toContain('data-fdn-sample="title,tone,on,count,rows,bare,meta"')
    expect(html).toContain('data-fdn-prop-tone="calm"')
    expect(html).toContain('data-fdn-prop-on="false"')
    expect(html).toContain('data-fdn-prop-count="0"')
    expect(html).toContain('data-fdn-prop-kept="Kept"')
    expect(html).toContain('<li data-fdn-id="Kinds::k2" data-fdn-index="0">name 1</li>')
    expect(html).toContain('<li data-fdn-id="Kinds::k2" data-fdn-index="1">name 2</li>')
    expect(bakeEditorComponent(doc, 'Badge').html).not.toContain('data-fdn-sample')
  })
})
