import type { ArtboardOp, ArtboardPage, BoardRef, BoardView, FdnDocument, FdnNode, PatchOp, ReportLine } from '../types.js'
import { indexNodes } from '../chain/model.js'

export const ARTBOARD_VERSION = '0.1.0-artboards'
export const ARTBOARD_TAGS = new Set(['fdn-page', 'fdn-artboard', 'fdn-artboard-view'])
export const boardKey = (ref: BoardRef): string => JSON.stringify([ref.artboardId, ref.state, ref.viewport])
export const DEFAULT_BOARD_SIZE = { width: 1440, height: 900 } as const
const attr = (node: FdnNode, key: string) => node.attrs[`data-fdn-${key}`]
const number = (node: FdnNode, key: string) => Number(attr(node, key))
export const explicitArtboards = (doc: FdnDocument): boolean => doc.specVersion === ARTBOARD_VERSION || doc.body.some(node => ARTBOARD_TAGS.has(node.tag))
const emptyNode = (id: string, tag: string, attrs: Record<string, string> = {}): FdnNode => ({ id, tag, attrs, style: {}, styleStates: {}, children: [] })
const viewRef = (node: FdnNode): Pick<BoardRef, 'state' | 'viewport'> => ({ state: attr(node, 'view-state') ?? null, viewport: attr(node, 'view-viewport') ?? null })
const canonical = (ref: Pick<BoardRef, 'state' | 'viewport'>) => ref.state === null && ref.viewport === null
const control = /[\u0000-\u001f\u007f]/
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
export function assertFormatVersion(doc: Pick<FdnDocument, 'specVersion'>): void {
  if (!['0.0.1-draft', '0.1.0', '0.2.0', ARTBOARD_VERSION].includes(doc.specVersion)) throw new Error(`unsupported-format-version: ${doc.specVersion}; update this Foundation writer`)
}

export function validateArtboards(doc: FdnDocument): ReportLine[] {
  const issues: ReportLine[] = []
  const issue = (node: FdnNode, code: string, message: string) => issues.push({ nodeId: node.id, code, message, severity: 'error' })
  const explicit = explicitArtboards(doc)
  if (explicit && doc.specVersion !== ARTBOARD_VERSION) issues.push({ code: 'artboard-format-version', severity: 'error', message: `artboard structure requires ${ARTBOARD_VERSION}` })
  const ids = new Set<string>()
  const visit = (node: FdnNode, parent: FdnNode | null, definition = false): void => {
    if (!definition) {
      if (!node.id || ids.has(node.id)) issue(node, 'artboard-duplicate-id', 'source identities must be unique and nonempty')
      ids.add(node.id)
    }
    if (ARTBOARD_TAGS.has(node.tag)) {
      if (definition || (node.tag === 'fdn-page' ? parent !== null : node.tag === 'fdn-artboard' ? parent?.tag !== 'fdn-page' : parent?.tag !== 'fdn-artboard')) issue(node, 'artboard-containment', 'pages belong at root, artboards inside pages, and views inside artboards')
      if (node.when !== undefined || node.each !== undefined || node.styleRef !== undefined || Object.keys(node.style).length || Object.values(node.styleStates).some(plane => plane && Object.keys(plane).length) || node.text !== undefined || Object.keys(node.attrs).some(key => key === 'data-fdn-state' || key.startsWith('data-fdn-mode-'))) issue(node, 'artboard-wrapper-style', 'structural artboard nodes cannot carry content, styles or bindings')
      if (node.tag !== 'fdn-artboard-view' && (!attr(node, 'name')?.trim() || control.test(attr(node, 'name')!))) issue(node, 'artboard-name', 'page and artboard names must be nonempty literal display names')
      if (node.tag !== 'fdn-page') {
        for (const key of node.tag === 'fdn-artboard' ? ['x', 'y', 'width', 'height'] : ['x', 'y', 'width', 'height'].filter(key => attr(node, key) !== undefined)) {
          const value = attr(node, key)
          if (value === undefined || !decimal.test(value) || !Number.isFinite(Number(value)) || (['width', 'height'].includes(key) && Number(value) <= 0)) issue(node, `artboard-number-${key}`, `${key} must be a finite literal ${['width', 'height'].includes(key) ? 'positive ' : ''}pixel number`)
        }
      }
      if (node.tag === 'fdn-artboard' && !['clip', 'visible'].includes(attr(node, 'overflow') ?? '')) issue(node, 'artboard-overflow', 'artboard overflow must be clip or visible')
      if (node.tag === 'fdn-artboard-view') {
        const ref = viewRef(node)
        if (node.children.length) issue(node, 'artboard-view-children', 'view metadata cannot contain design content')
        if (canonical(ref) && (attr(node, 'x') !== undefined || attr(node, 'y') !== undefined)) issue(node, 'artboard-native-position', 'canonical position belongs to artboard X/Y')
        if ((attr(node, 'x') === undefined) !== (attr(node, 'y') === undefined)) issue(node, 'artboard-view-position', 'view positions require both X and Y')
        if (canonical(ref) && attr(node, 'width') !== undefined) issue(node, 'artboard-native-size', 'canonical size belongs to artboard W/H')
        if ((attr(node, 'width') === undefined) !== (attr(node, 'height') === undefined)) issue(node, 'artboard-view-size', 'view size override requires both dimensions')
        if (attr(node, 'visible') !== undefined && !['true', 'false'].includes(attr(node, 'visible')!)) issue(node, 'artboard-view-visible', 'view visibility must be true or false')
        if (ref.state !== null && (!ref.state || !doc.states.some(state => state.name === ref.state))) issue(node, 'artboard-view-state', 'view references an unknown state')
        if (ref.viewport !== null && (!ref.viewport || !doc.viewports.some(viewport => viewport.name === ref.viewport))) issue(node, 'artboard-view-viewport', 'view references an unknown viewport')
      }
      if (node.tag === 'fdn-artboard') {
        const tuples = new Set<string>()
        for (const view of node.children.filter(child => child.tag === 'fdn-artboard-view')) {
          const key = boardKey({ artboardId: node.id, ...viewRef(view) })
          if (tuples.has(key)) issue(view, 'artboard-view-duplicate', 'only one view record per artboard/state/viewport tuple is allowed')
          tuples.add(key)
        }
      }
    } else if (!definition && explicit && (parent === null || parent.tag === 'fdn-page')) issue(node, 'artboard-loose-content', 'explicit documents contain pages and artboards before design content')
    node.children.forEach(child => visit(child, node, definition))
  }
  doc.body.forEach(node => visit(node, null))
  for (const component of doc.components) component.body.forEach(node => visit(node, null, true))
  return issues
}

export function artboardPages(doc: FdnDocument): ArtboardPage[] {
  return doc.body.filter(node => node.tag === 'fdn-page').map(page => ({ id: page.id, name: attr(page, 'name') ?? page.id, artboardIds: page.children.filter(node => node.tag === 'fdn-artboard').map(node => node.id) }))
}

function generatedRefs(doc: FdnDocument): Array<Pick<BoardRef, 'state' | 'viewport'>> {
  if (doc.matrix.length) return doc.matrix.map(cell => ({ state: cell.state || null, viewport: cell.viewport }))
  if (doc.states.length) return doc.states.map(state => ({ state: state.name, viewport: state.viewport ?? doc.viewports[0]?.name ?? null }))
  if (doc.viewports.length) return doc.viewports.map(viewport => ({ state: null, viewport: viewport.name }))
  return [{ state: null, viewport: null }]
}

export function boardView(doc: FdnDocument, ref: BoardRef): BoardView {
  if (ref.state !== null && !doc.states.some(state => state.name === ref.state)) throw new Error(`unknown-state: ${ref.state}`)
  const viewport = ref.viewport === null ? undefined : doc.viewports.find(viewport => viewport.name === ref.viewport)
  if (ref.viewport !== null && !viewport) throw new Error(`unknown-viewport: ${ref.viewport}`)
  if (!explicitArtboards(doc)) {
    if (ref.artboardId !== null) throw new Error(`unknown-artboard: ${ref.artboardId}`)
    const refs = generatedRefs(doc)
    const position = Math.max(0, refs.findIndex(item => item.state === ref.state && item.viewport === ref.viewport))
    const x = refs.slice(0, position).reduce((sum, item) => sum + (doc.viewports.find(v => v.name === item.viewport)?.width ?? DEFAULT_BOARD_SIZE.width) + 120, 0)
    return { ...ref, pageId: null, name: doc.title ?? 'Design', x, y: 0, width: viewport?.width ?? DEFAULT_BOARD_SIZE.width, height: viewport?.height ?? DEFAULT_BOARD_SIZE.height, visible: true, overflow: 'visible', sizeOverride: false }
  }
  const page = doc.body.find(page => page.tag === 'fdn-page' && page.children.some(board => board.tag === 'fdn-artboard' && board.id === ref.artboardId))
  const board = page?.children.find(board => board.id === ref.artboardId)
  if (!board) throw new Error(`unknown-artboard: ${ref.artboardId}`)
  const record = board.children.find(node => node.tag === 'fdn-artboard-view' && viewRef(node).state === ref.state && viewRef(node).viewport === ref.viewport)
  const refs = [{ state: null, viewport: null }, ...generatedRefs(doc)].filter((item, i, all) => all.findIndex(other => other.state === item.state && other.viewport === item.viewport) === i)
  const offset = Math.max(0, refs.findIndex(item => item.state === ref.state && item.viewport === ref.viewport))
  const sizeOverride = record !== undefined && attr(record, 'width') !== undefined
  return { ...ref, pageId: page!.id, name: attr(board, 'name') ?? board.id, x: record && attr(record, 'x') !== undefined ? number(record, 'x') : number(board, 'x') + offset * (number(board, 'width') + 120), y: record && attr(record, 'y') !== undefined ? number(record, 'y') : number(board, 'y'), width: sizeOverride ? number(record!, 'width') : viewport?.width ?? number(board, 'width'), height: sizeOverride ? number(record!, 'height') : viewport?.height ?? number(board, 'height'), visible: attr(record ?? board, 'visible') !== 'false', overflow: attr(board, 'overflow') === 'clip' ? 'clip' : 'visible', sizeOverride }
}

export function boardViews(doc: FdnDocument): BoardView[] {
  if (!explicitArtboards(doc)) return generatedRefs(doc).map(ref => boardView(doc, { artboardId: null, ...ref }))
  const views: BoardView[] = []
  for (const page of doc.body.filter(node => node.tag === 'fdn-page')) for (const board of page.children.filter(node => node.tag === 'fdn-artboard')) {
    const refs = [{ state: null, viewport: null }, ...generatedRefs(doc), ...board.children.filter(node => node.tag === 'fdn-artboard-view').map(viewRef)]
    const seen = new Set<string>()
    for (const ref of refs) {
      const key = boardKey({ artboardId: board.id, ...ref })
      if (seen.has(key)) continue
      seen.add(key)
      try { views.push(boardView(doc, { artboardId: board.id, ...ref })) } catch {}
    }
  }
  return views
}

export function selectArtboard(doc: FdnDocument, id?: string | null): { doc: FdnDocument; artboardId: string | null } {
  if (!explicitArtboards(doc)) {
    if (id != null) throw new Error(`unknown-artboard: ${id}`)
    return { doc, artboardId: null }
  }
  const boards = doc.body.flatMap(page => page.children).filter(node => node.tag === 'fdn-artboard')
  const board = id == null && boards.length === 1 ? boards[0] : boards.find(board => board.id === id)
  if (!board) throw new Error(id == null ? 'ambiguous-artboard: select one artboard' : `unknown-artboard: ${id}`)
  return { doc: { ...doc, body: board.children.filter(node => node.tag !== 'fdn-artboard-view') }, artboardId: board.id }
}

export class ArtboardError extends Error {
  constructor(readonly code: 'unknown-node' | 'duplicate-id' | 'invalid-op' | 'conflict', message: string) { super(message) }
}

export function expandArtboardOp(doc: FdnDocument, op: ArtboardOp): PatchOp[] {
  const index = indexNodes(doc.body)
  const fail = (message: string): never => { throw new ArtboardError('invalid-op', message) }
  const node = (id: string, tag: string): FdnNode => {
    const found = index.get(id)?.node
    if (!found) throw new ArtboardError('unknown-node', `unknown ${tag}: ${id}`)
    if (found.tag !== tag) fail(`expected ${tag}: ${id}`)
    return found
  }
  const set = (id: string, key: string, value: string | number | boolean | null): PatchOp => ({ op: 'set-attr', id, key: `data-fdn-${key}`, value: value === null ? null : String(value) })
  const size = (width: number, height: number): void => { if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) fail('dimensions must be finite and positive') }
  const name = (value: string): void => { if (!value.trim() || control.test(value)) fail('name must be nonempty without control characters') }
  const position = (siblings: FdnNode[], beforeId: string | null, moving?: string): number => {
    const remaining = siblings.filter(item => item.id !== moving)
    if (beforeId === moving) fail('cannot order an object before itself')
    const offset = beforeId === null ? remaining.length : remaining.findIndex(item => item.id === beforeId)
    if (offset < 0) throw new ArtboardError('conflict', 'ordering anchor is missing from destination')
    return offset
  }
  const record = (ref: { id: string; artboardId: string; state: string | null; viewport: string | null }): { id: string; ops: PatchOp[] } => {
    const board = node(ref.artboardId, 'fdn-artboard')
    boardView(doc, ref)
    const found = board.children.find(child => child.tag === 'fdn-artboard-view' && viewRef(child).state === ref.state && viewRef(child).viewport === ref.viewport)
    if (found) return { id: found.id, ops: [] }
    const attrs: Record<string, string> = {}
    if (ref.state !== null) attrs['data-fdn-view-state'] = ref.state
    if (ref.viewport !== null) attrs['data-fdn-view-viewport'] = ref.viewport
    return { id: ref.id, ops: [{ op: 'insert-node', parent: board.id, index: board.children.length, node: emptyNode(ref.id, 'fdn-artboard-view', attrs) }] }
  }
  if (op.op === 'upgrade-artboards') {
    if (explicitArtboards(doc)) fail('document already has explicit artboards')
    name(op.name); size(op.width, op.height)
    const native = op.placements.find(canonical) ?? op.placements[0]
    const page = emptyNode(op.pageId, 'fdn-page', { 'data-fdn-name': 'Page 1' })
    const board = emptyNode(op.artboardId, 'fdn-artboard', { 'data-fdn-name': op.name, 'data-fdn-x': String(native?.x ?? 0), 'data-fdn-y': String(native?.y ?? 0), 'data-fdn-width': String(op.width), 'data-fdn-height': String(op.height), 'data-fdn-overflow': 'visible' })
    const placements = op.placements.filter(ref => !canonical(ref)).map(ref => emptyNode(ref.id, 'fdn-artboard-view', { ...(ref.state === null ? {} : { 'data-fdn-view-state': ref.state }), ...(ref.viewport === null ? {} : { 'data-fdn-view-viewport': ref.viewport }), 'data-fdn-x': String(ref.x), 'data-fdn-y': String(ref.y) }))
    const ops: PatchOp[] = [{ op: 'set-spec-version', specVersion: ARTBOARD_VERSION }, { op: 'insert-node', parent: null, index: doc.body.length, node: page }, { op: 'insert-node', parent: page.id, index: 0, node: board }]
    doc.body.forEach((child, i) => ops.push({ op: 'move-node', id: child.id, parent: board.id, index: i }))
    placements.forEach((view, i) => ops.push({ op: 'insert-node', parent: board.id, index: doc.body.length + i, node: view }))
    for (const annotation of doc.annotations) if (annotation.artboardId === undefined) ops.push({ op: 'annotate', annotation: { ...annotation, artboardId: board.id } })
    return ops
  }
  if (op.op === 'rename-state' || op.op === 'rename-viewport') {
    name(op.newName)
    const states = op.op === 'rename-state'
    const list = states ? doc.states : doc.viewports
    const current = list.find(item => item.name === op.name)
    if (!current) fail(`unknown declaration: ${op.name}`)
    if (op.name === op.newName) return []
    if (list.some(item => item.name === op.newName)) fail('declaration name is occupied')
    const ops: PatchOp[] = states ? [{ op: 'set-state', state: { ...doc.states.find(item => item.name === op.name)!, name: op.newName }, index: list.findIndex(item => item.name === op.name) }, { op: 'remove-state', name: op.name }] : [{ op: 'set-viewport', viewport: { ...doc.viewports.find(item => item.name === op.name)!, name: op.newName }, index: list.findIndex(item => item.name === op.name) }, { op: 'remove-viewport', name: op.name }]
    for (const loc of index.values()) {
      for (const key of states ? ['data-fdn-state', 'data-fdn-view-state'] : ['data-fdn-viewport', 'data-fdn-view-viewport']) if (loc.node.attrs[key] === op.name) ops.push({ op: 'set-attr', id: loc.node.id, key, value: op.newName })
    }
    for (const component of doc.components) {
      const copy = structuredClone(component)
      let changed = false
      const walk = (nodes: FdnNode[]): void => { for (const child of nodes) { const key = states ? 'data-fdn-state' : 'data-fdn-viewport'; if (child.attrs[key] === op.name) { child.attrs[key] = op.newName; changed = true } walk(child.children) } }
      walk(copy.body)
      if (changed) ops.push({ op: 'set-component', component: copy })
    }
    if (!states) for (const state of doc.states) if (state.viewport === op.name) ops.push({ op: 'set-state', state: { ...state, viewport: op.newName } })
    ops.push({ op: 'set-matrix', cells: doc.matrix.map(cell => ({ state: states && cell.state === op.name ? op.newName : cell.state, viewport: !states && cell.viewport === op.name ? op.newName : cell.viewport })) })
    for (const annotation of doc.annotations) if ((states ? annotation.state : annotation.viewport) === op.name) ops.push({ op: 'annotate', annotation: { ...annotation, [states ? 'state' : 'viewport']: op.newName } })
    return ops
  }
  if (op.op === 'resize-viewport') {
    size(op.width, op.height)
    const viewport = doc.viewports.find(viewport => viewport.name === op.name)
    if (!viewport) fail(`unknown viewport: ${op.name}`)
    return [{ op: 'set-viewport', viewport: { ...viewport!, width: op.width, height: op.height } }]
  }
  if (op.op === 'create-page') { name(op.name); return [...(explicitArtboards(doc) ? [] : doc.body.length ? fail('upgrade the legacy document before adding pages') : [{ op: 'set-spec-version', specVersion: ARTBOARD_VERSION } as PatchOp]), { op: 'insert-node', parent: null, index: position(doc.body, op.beforeId), node: emptyNode(op.id, 'fdn-page', { 'data-fdn-name': op.name }) }] }
  if (op.op === 'create-artboard') {
    name(op.name); size(op.width, op.height)
    const page = node(op.pageId, 'fdn-page')
    return [{ op: 'insert-node', parent: page.id, index: position(page.children, op.beforeId), node: emptyNode(op.id, 'fdn-artboard', { 'data-fdn-name': op.name, 'data-fdn-x': String(op.x), 'data-fdn-y': String(op.y), 'data-fdn-width': String(op.width), 'data-fdn-height': String(op.height), 'data-fdn-overflow': op.overflow ?? 'clip' }) }]
  }
  if (['rename-page', 'rename-artboard', 'delete-page', 'delete-artboard', 'reorder-page', 'reorder-artboard', 'move-artboard', 'resize-artboard', 'duplicate-page', 'duplicate-artboard'].includes(op.op)) {
    if (!('id' in op)) return fail('operation requires an id')
    const source = node(op.id, op.op.endsWith('page') ? 'fdn-page' : 'fdn-artboard')
    if (op.op === 'rename-page' || op.op === 'rename-artboard') { name(op.name); return [set(op.id, 'name', op.name)] }
    if (op.op === 'delete-page' || op.op === 'delete-artboard') return [{ op: 'remove-node', id: op.id }]
    if (op.op === 'move-artboard') return [set(op.id, 'x', op.x), set(op.id, 'y', op.y)]
    if (op.op === 'resize-artboard') { size(op.width, op.height); return [set(op.id, 'width', op.width), set(op.id, 'height', op.height)] }
    if (op.op === 'reorder-page' || op.op === 'reorder-artboard') {
      const parent = op.op === 'reorder-page' ? null : node(op.pageId, 'fdn-page')
      return [{ op: 'move-node', id: source.id, parent: parent?.id ?? null, index: position(parent?.children ?? doc.body, op.beforeId, source.id) }]
    }
    if (op.op === 'duplicate-page' || op.op === 'duplicate-artboard') {
      name(op.name)
      const descendants = [...indexNodes(source.children).keys()]
      if (descendants.length !== Object.keys(op.idMap).length || descendants.some(id => !Object.hasOwn(op.idMap, id) || !op.idMap[id])) throw new ArtboardError('conflict', 'duplicate source changed; refresh the complete descendant id map')
      const copy = structuredClone(source)
      const replacements = new Map<string, string>()
      const mapping = { ...op.idMap, [source.id]: op.newId }
      const all = indexNodes([copy])
      for (const loc of all.values()) {
        const htmlId = loc.node.attrs.id
        if (htmlId) {
          if (replacements.has(htmlId)) fail('duplicate HTML ids make reference rewriting ambiguous')
          replacements.set(htmlId, `${htmlId}--${op.newId}`)
        }
      }
      const refs = new Set(['href', 'xlink:href', 'for', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'headers', 'data-fdn-anchor-ref'])
      for (const loc of all.values()) {
        const child = loc.node
        child.id = mapping[child.id]!
        for (const [key, value] of Object.entries(child.attrs)) {
          if (key === 'id') child.attrs[key] = replacements.get(value)!
          else if (refs.has(key)) child.attrs[key] = key.includes('href') ? value.startsWith('#') && replacements.has(value.slice(1)) ? `#${replacements.get(value.slice(1))}` : value : value.split(' ').map(part => mapping[part] ?? replacements.get(part) ?? part).join(' ')
          else if (value.includes('url(#')) fail(`cannot safely duplicate reference in ${key}`)
        }
        if ([...Object.values(child.style), ...Object.values(child.styleStates).flatMap(plane => Object.values(plane ?? {}))].some(value => /url\(\s*['"]?#/.test(value))) fail('cannot safely duplicate CSS fragment references')
      }
      copy.attrs['data-fdn-name'] = op.name
      if (op.op === 'duplicate-artboard') {
        const dx = op.x - number(source, 'x'), dy = op.y - number(source, 'y')
        copy.attrs['data-fdn-x'] = String(op.x); copy.attrs['data-fdn-y'] = String(op.y)
        for (const view of copy.children.filter(child => child.tag === 'fdn-artboard-view')) if (attr(view, 'x') !== undefined) { view.attrs['data-fdn-x'] = String(number(view, 'x') + dx); view.attrs['data-fdn-y'] = String(number(view, 'y') + dy) }
        const page = node(op.pageId, 'fdn-page')
        return [{ op: 'insert-node', parent: page.id, index: position(page.children, op.beforeId), node: copy }]
      }
      return [{ op: 'insert-node', parent: null, index: index.get(source.id)!.index + 1, node: copy }]
    }
  }
  if (op.op === 'move-artboard-view' || op.op === 'set-artboard-view-visible' || op.op === 'set-artboard-view-size' || op.op === 'separate-artboard-view') {
    if (op.op === 'set-artboard-view-size' && canonical(op)) fail('resize the canonical artboard with resize-artboard')
    if (op.op === 'move-artboard-view' && canonical(op)) fail('move the canonical artboard with move-artboard')
    const target = record(op)
    if (op.op === 'move-artboard-view') return [...target.ops, set(target.id, 'x', op.x), set(target.id, 'y', op.y)]
    if (op.op === 'set-artboard-view-visible') return [...target.ops, set(target.id, 'visible', op.visible)]
    if (op.op === 'set-artboard-view-size' && (op.width === null || op.height === null)) {
      if (op.width !== null || op.height !== null) fail('clear both size override dimensions together')
      return [...target.ops, set(target.id, 'width', null), set(target.id, 'height', null)]
    }
    size(op.width!, op.height!)
    const ops = [...target.ops, set(target.id, 'width', op.width), set(target.id, 'height', op.height)]
    if (op.op === 'separate-artboard-view') {
      const viewport = doc.viewports.find(viewport => viewport.name === op.viewport)
      if (!viewport || viewport.width !== op.expectedViewport.width || viewport.height !== op.expectedViewport.height) throw new ArtboardError('conflict', 'shared viewport changed since resize; refresh before separating')
      size(op.restoreViewport.width, op.restoreViewport.height)
      ops.push({ op: 'set-viewport', viewport: { ...viewport, ...op.restoreViewport } })
    }
    return ops
  }
  return fail(`unsupported artboard operation ${op.op}`)
}

export function artboardActivity(before: FdnDocument, after: FdnDocument, ops: PatchOp[]): { artboardIds: string[]; pageIds: string[]; insertedNodeIds: string[]; removedNodeIds: string[] } {
  const beforeIndex = indexNodes(before.body), afterIndex = indexNodes(after.body)
  const insertedNodeIds = [...afterIndex.keys()].filter(id => !beforeIndex.has(id))
  const removedNodeIds = [...beforeIndex.keys()].filter(id => !afterIndex.has(id))
  const artboardIds = new Set<string>(), pageIds = new Set<string>()
  const ids = new Set<string>()
  for (const op of ops) {
    if ('id' in op) ids.add(op.id)
    if (op.op === 'insert-node') for (const id of indexNodes([op.node]).keys()) ids.add(id)
  }
  for (const index of [beforeIndex, afterIndex]) {
    for (const id of new Set([...ids, ...insertedNodeIds, ...removedNodeIds])) {
      let loc = index.get(id)
      while (loc) {
        if (loc.node.tag === 'fdn-artboard') artboardIds.add(loc.node.id)
        if (loc.node.tag === 'fdn-page') pageIds.add(loc.node.id)
        loc = loc.parent === null ? undefined : index.get(loc.parent)
      }
    }
  }
  return { artboardIds: [...artboardIds].sort(), pageIds: [...pageIds].sort(), insertedNodeIds, removedNodeIds }
}
