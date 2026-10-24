import type { ArtboardOp, BoardRef, BoardView, ArtboardPage } from './document.ts'
import type { ChainLogEntry, EnvelopeRecord, FdnDocument, ComponentSwapTarget, InstanceDetachReport, InstanceSwapReport, InstanceOverridePatch, PatchOp, ReportLine } from './document.ts'

export type { EnvelopeRecord, FdnDocument, FdnNode, PatchOp, ReportLine } from './document.ts'

export const SESSION_PROTOCOL = '0.2'
export const LEGACY_SESSION_PROTOCOL = '0.1'
export type SessionProtocol = typeof SESSION_PROTOCOL | typeof LEGACY_SESSION_PROTOCOL
export function isSessionProtocol(value: string): value is SessionProtocol { return value === SESSION_PROTOCOL || value === LEGACY_SESSION_PROTOCOL }

export interface History {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
}

export type Cause =
  | { kind: 'open' }
  | { kind: 'commit' | 'undo' | 'redo'; id: string; author: string }
  | { kind: 'external'; author: string | null }

export interface DocumentView {
  rev: number
  doc: FdnDocument
  head: EnvelopeRecord | null
  history: History
  issues: ReportLine[]
  pages: ArtboardPage[]
  boards: BoardView[]
  unavailableBoards?: BoardRef[]
}

export type HorizontalConstraint = 'left' | 'right' | 'left-right' | 'center' | 'scale'
export type VerticalConstraint = 'top' | 'bottom' | 'top-bottom' | 'center' | 'scale'
export interface FreeBounds { x: number; y: number; width: number; height: number; frameWidth: number; frameHeight: number }

export type PlacementOp =
  | { op: 'set-frame-mode'; id: string; mode: 'free' | 'flow' }
  | { op: 'set-free-position'; id: string; x: number; y: number; bounds?: FreeBounds }
  | { op: 'resize-free'; id: string; width: number; height: number; bounds?: FreeBounds }
  | { op: 'set-free-rotation'; id: string; degrees: number }
  | { op: 'set-free-flip'; id: string; x?: boolean; y?: boolean }
  | { op: 'set-free-constraints'; id: string; h: HorizontalConstraint; v: VerticalConstraint; bounds?: FreeBounds }
  | { op: 'set-placement'; id: string; mode: 'free'; bounds: { x: number; y: number; width: number; height: number } }
  | { op: 'set-placement'; id: string; mode: 'flow' }

export type TokenModeOp =
  | { op: 'create-token-collection'; name: string; modes: string[] }
  | { op: 'add-token-mode'; collection: string; name: string; from?: string }
  | { op: 'rename-token-mode'; collection: string; name: string; newName: string }
  | { op: 'remove-token-mode'; collection: string; name: string }
  | { op: 'set-mode-token'; collection: string; name: string; type?: import('./document.ts').FdnTokenType; mode: string; value: import('./document.ts').FdnTokenValue }
  | { op: 'set-collection-mode'; id: string; collection: string; mode: string | null }

export interface SwapPreviewGuard { previewRev?: number; previewSignature?: string }

export type ComponentOp =
  | { op: 'detach-instance'; id: string; state: string | null }
  | ({ op: 'set-instance-variant'; id: string; values: Record<string, string | null> | null } & SwapPreviewGuard)
  | ({ op: 'swap-instance'; id: string; target: ComponentSwapTarget } & SwapPreviewGuard)
  | { op: 'set-instance-override'; id: string; target: string[]; values: InstanceOverridePatch }
  | { op: 'reset-instance-override'; id: string; target: string[] }
  | { op: 'reset-instance-overrides'; id: string }

export type SessionOp = PatchOp | PlacementOp | TokenModeOp | ComponentOp | ArtboardOp

export type ClientMessage =
  | { t: 'hello'; protocol: string; client: string; author: string; earlyResult?: boolean }
  | { t: 'view'; boards: BoardRef[]; components: boolean; bakeDiffs?: boolean }
  | { t: 'commit'; id: string; base: number; ops: SessionOp[]; label: string }
  | { t: 'preview-instance-swap'; id: string; op: Extract<ComponentOp, { op: 'swap-instance' | 'set-instance-variant' }> }
  | { t: 'anchor'; id: string; name: string }
  | { t: 'undo'; id: string }
  | { t: 'redo'; id: string }
  | { t: 'log'; id: string; limit: number; before?: string }
  | { t: 'activity'; id: string; limit: number; since?: string; cursor?: string }

export type LegacyClientMessage = Exclude<ClientMessage, { t: 'view' }> | { t: 'view'; states: Array<string | null>; components: boolean; bakeDiffs?: boolean }
export type WireClientMessage = ClientMessage | LegacyClientMessage

export type ServiceMessage =
  | ({ t: 'welcome'; protocol: string; path: string; docId: string | null; chain: boolean; created: boolean } & DocumentView)
  | ({ t: 'doc'; cause: Cause } & DocumentView)
  | ({ t: 'baked'; rev: number; html: string; report: ReportLine[] } & BoardView)
  | ({ t: 'baked-diff'; rev: number; baseRev: number; start: number; deleteCount: number; insert: string; report: ReportLine[] } & BoardView)
  | { t: 'component'; rev: number; name: string; html: string; report: ReportLine[] }
  | { t: 'instance-swap-preview'; id: string; rev: number; report: InstanceSwapReport }
  | { t: 'result'; id: string; ok: true; rev: number; componentSwaps?: InstanceSwapReport[]; componentDetaches?: InstanceDetachReport[] }
  | { t: 'result'; id: string; ok: false; code: ResultCode; message: string }
  | { t: 'log'; id: string; entries: Array<EnvelopeRecord & Partial<Omit<ChainLogEntry, keyof EnvelopeRecord>>>; nextCursor?: string | null; latestCursor?: string | null; hasMore?: boolean }
  | { t: 'activity'; id: string; entries: ChainLogEntry[]; frontier: string; nextCursor: string | null; hasMore: boolean }
  | { t: 'fault'; code: FaultCode; message: string }

export type LegacyDocumentView = Omit<DocumentView, 'pages' | 'boards' | 'unavailableBoards'>
export type LegacyServiceMessage =
  | ({ t: 'welcome'; protocol: typeof LEGACY_SESSION_PROTOCOL; path: string; docId: string | null; chain: boolean; created: boolean } & LegacyDocumentView)
  | ({ t: 'doc'; cause: Cause } & LegacyDocumentView)
  | { t: 'baked'; rev: number; state: string | null; html: string; report: ReportLine[] }
  | { t: 'baked-diff'; rev: number; state: string | null; baseRev: number; start: number; deleteCount: number; insert: string; report: ReportLine[] }
  | Exclude<ServiceMessage, { t: 'welcome' | 'doc' | 'baked' | 'baked-diff' }>
export type WireServiceMessage = ServiceMessage | LegacyServiceMessage

export const RESULT_CODES = ['unknown-node', 'duplicate-id', 'invalid-op', 'nothing-to-undo', 'nothing-to-redo', 'conflict', 'write-failed'] as const
export type ResultCode = (typeof RESULT_CODES)[number]

export const FAULT_CODES = ['protocol', 'unreadable', 'not-found', 'exists', 'internal'] as const
export type FaultCode = (typeof FAULT_CODES)[number]

type Check = (value: unknown) => boolean

const STYLE_STATES = ['hover', 'focus', 'active', 'disabled']
const PARAM_TYPES = ['string', 'number', 'boolean', 'enum', 'token', 'list', 'record']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isString: Check = (value) => typeof value === 'string'
const isNumber: Check = (value) => typeof value === 'number' && Number.isFinite(value)
const isInteger: Check = (value) => Number.isInteger(value)
const isCount: Check = (value) => Number.isInteger(value) && (value as number) >= 0
const isBoolean: Check = (value) => typeof value === 'boolean'
const isAnything: Check = () => true
const oneOf = (options: readonly unknown[]): Check => (value) => options.includes(value)
const nullable = (check: Check): Check => (value) => value === null || check(value)
const optional = (check: Check): Check => (value) => value === undefined || check(value)
const arrayOf = (check: Check): Check => (value) => Array.isArray(value) && value.every(check)
const recordOf = (check: Check): Check => (value) => isRecord(value) && Object.values(value).every(check)
const shape = (fields: Record<string, Check>): Check => (value) => isRecord(value) && Object.entries(fields).every(([key, check]) => check(value[key]))

const isStringMap = recordOf(isString)
const isStyleState = oneOf(STYLE_STATES)
const isStyleStates: Check = (value) => isRecord(value) && Object.entries(value).every(([key, plane]) => isStyleState(key) && (plane === undefined || isStringMap(plane)))
const isNode: Check = (value) => isNodeShape(value)
const isNodeShape = shape({
  id: isString,
  tag: isString,
  attrs: isStringMap,
  style: isStringMap,
  styleStates: isStyleStates,
  styleRef: optional(isString),
  when: optional(isString),
  each: optional(isString),
  text: optional(isString),
  children: arrayOf(isNode),
})
const isParam = shape({ name: isString, type: oneOf(PARAM_TYPES), values: optional(arrayOf(isString)), default: isAnything, description: optional(isString) })
const isProp = shape({ name: isString, type: oneOf(PARAM_TYPES), values: optional(arrayOf(isString)), required: optional(isBoolean), default: isAnything })
const isDataSet = shape({ name: isString, items: arrayOf(isRecord) })
const isLookup = shape({ name: isString, entries: isStringMap })
const isState = shape({ name: isString, assignments: isRecord, viewport: optional(isString) })
const isViewport = shape({ name: isString, width: isNumber, height: isNumber })
const isNamedStyle = shape({ name: isString, style: isStringMap, styleStates: isStyleStates })
const isComponent = shape({
  name: isString,
  props: arrayOf(isProp),
  slots: arrayOf(isString),
  body: arrayOf(isNode),
  sealed: optional(shape({ html: isString, css: isString })),
  provenance: optional(shape({ source: isString, contentSha256: isString })),
})
const isComponentSet = shape({ name: isString, properties: recordOf(arrayOf(isString)), defaultVariant: isStringMap, variants: arrayOf(shape({ values: isStringMap, component: isString })) })
const isAnnotationStatus = oneOf(['open', 'resolved', 'wontfix'])
const isAnnotation = shape({
  id: isString,
  nodeId: optional(isString),
  artboardId: optional(isString),
  viewport: optional(isString),
  x: optional(isNumber),
  y: optional(isNumber),
  state: optional(isString),
  text: isString,
  status: isAnnotationStatus,
})
const isTokenType = oneOf(['color', 'number', 'string', 'boolean'])
const isTokenValue: Check = (value) => isString(value) || isNumber(value) || isBoolean(value) || shape({ alias: isString })(value)
const isTokenCollection = shape({ name: isString, modes: arrayOf(isString), tokens: arrayOf(shape({ name: isString, type: isTokenType, values: recordOf(isTokenValue) })) })
const isDocument = shape({
  specVersion: isString,
  title: optional(isString),
  tokens: isStringMap,
  componentSets: optional(arrayOf(isComponentSet)),
  tokenCollections: optional(arrayOf(isTokenCollection)),
  params: arrayOf(isParam),
  data: arrayOf(isDataSet),
  lookups: arrayOf(isLookup),
  states: arrayOf(isState),
  viewports: arrayOf(isViewport),
  matrix: arrayOf(shape({ state: isString, viewport: isString })),
  namedStyles: arrayOf(isNamedStyle),
  components: arrayOf(isComponent),
  body: arrayOf(isNode),
  annotations: arrayOf(isAnnotation),
})

const PATCH_OPS: Record<PatchOp['op'], Check> = {
  'set-spec-version': shape({ specVersion: isString }),
  'set-title': shape({ title: nullable(isString) }),
  'insert-node': shape({ parent: nullable(isString), index: isInteger, node: isNode }),
  'remove-node': shape({ id: isString }),
  'move-node': shape({ id: isString, parent: nullable(isString), index: isInteger }),
  'set-attr': shape({ id: isString, key: isString, value: nullable(isString) }),
  'set-style': shape({ id: isString, prop: isString, value: nullable(isString), state: optional(isStyleState), replaceBinding: optional(isBoolean) }),
  'set-style-ref': shape({ id: isString, styleRef: nullable(isString) }),
  'set-text': shape({ id: isString, text: isString }),
  'set-when': shape({ id: isString, when: nullable(isString) }),
  'set-component-set': shape({ componentSet: isComponentSet, index: optional(isCount) }),
  'remove-component-set': shape({ name: isString }),
  'set-token-collection': shape({ collection: isTokenCollection, index: optional(isCount) }),
  'remove-token-collection': shape({ name: isString }),
  'set-token': shape({ name: isString, value: nullable(isString) }),
  'set-named-style': shape({ style: isNamedStyle }),
  'remove-named-style': shape({ name: isString }),
  'set-component': shape({ component: isComponent, index: optional(isCount) }),
  'remove-component': shape({ name: isString }),
  'set-param': shape({ param: isParam, index: optional(isCount) }),
  'remove-param': shape({ name: isString }),
  'set-lookup': shape({ lookup: isLookup, index: optional(isCount), createOnly: optional(isBoolean) }),
  'set-lookup-entry': shape({ name: isString, key: isString, value: nullable(isString) }),
  'remove-lookup': shape({ name: isString }),
  'set-state': shape({ state: isState, index: optional(isCount) }),
  'remove-state': shape({ name: isString }),
  'set-data': shape({ data: isDataSet, index: optional(isCount) }),
  'remove-data': shape({ name: isString }),
  'set-viewport': shape({ viewport: isViewport, index: optional(isCount) }),
  'remove-viewport': shape({ name: isString }),
  'set-matrix': shape({ cells: arrayOf(shape({ state: isString, viewport: isString })) }),
  'set-declaration-order': shape({ section: oneOf(['params', 'data', 'lookups', 'states', 'viewports', 'namedStyles', 'components', 'componentSets', 'tokenCollections']), names: arrayOf(isString) }),
  annotate: shape({ annotation: isAnnotation }),
  'set-annotation-status': shape({ id: isString, status: isAnnotationStatus }),
  'remove-annotation': shape({ id: isString }),
  'replace-document': shape({ doc: isDocument }),
}

const isFreeBounds = shape({ x: isNumber, y: isNumber, width: isNumber, height: isNumber, frameWidth: isNumber, frameHeight: isNumber })

const PLACEMENT_OPS: Record<PlacementOp['op'], Check> = {
  'set-frame-mode': shape({ id: isString, mode: oneOf(['free', 'flow']) }),
  'set-free-position': shape({ id: isString, x: isNumber, y: isNumber, bounds: optional(isFreeBounds) }),
  'resize-free': shape({ id: isString, width: isNumber, height: isNumber, bounds: optional(isFreeBounds) }),
  'set-free-rotation': shape({ id: isString, degrees: isNumber }),
  'set-free-flip': shape({ id: isString, x: optional(isBoolean), y: optional(isBoolean) }),
  'set-free-constraints': shape({ id: isString, h: oneOf(['left', 'right', 'left-right', 'center', 'scale']), v: oneOf(['top', 'bottom', 'top-bottom', 'center', 'scale']), bounds: optional(isFreeBounds) }),
  'set-placement': (value) => shape({ id: isString, mode: oneOf(['free', 'flow']) })(value) && (isRecord(value) && (value.mode === 'flow' || shape({ bounds: shape({ x: isNumber, y: isNumber, width: isNumber, height: isNumber }) })(value))),
}
const isPlacementOp: Check = (value) => isRecord(value) && typeof value.op === 'string' && Object.hasOwn(PLACEMENT_OPS, value.op) && PLACEMENT_OPS[value.op as PlacementOp['op']](value)

const isPatchOp: Check = (value) => isRecord(value) && typeof value.op === 'string' && Object.hasOwn(PATCH_OPS, value.op) && PATCH_OPS[value.op as PatchOp['op']](value)

const TOKEN_MODE_OPS: Record<TokenModeOp['op'], Check> = {
  'create-token-collection': shape({ name: isString, modes: arrayOf(isString) }),
  'add-token-mode': shape({ collection: isString, name: isString, from: optional(isString) }),
  'rename-token-mode': shape({ collection: isString, name: isString, newName: isString }),
  'remove-token-mode': shape({ collection: isString, name: isString }),
  'set-mode-token': shape({ collection: isString, name: isString, type: optional(isTokenType), mode: isString, value: isTokenValue }),
  'set-collection-mode': shape({ id: isString, collection: isString, mode: nullable(isString) }),
}
const isSwapTarget: Check = (value) => isRecord(value) && ((typeof value.component === 'string' && value.componentSet === undefined && value.variants === undefined) || (typeof value.componentSet === 'string' && value.component === undefined && (value.variants === undefined || isStringMap(value.variants))))
const isOverrideValues = shape({ text: optional(nullable(isString)), hidden: optional(nullable(isBoolean)), style: optional(recordOf(nullable(isString))), styleStates: optional(recordOf(recordOf(nullable(isString)))), swap: optional(nullable(isSwapTarget)) })
const COMPONENT_OPS: Record<ComponentOp['op'], Check> = {
  'detach-instance': shape({ id: isString, state: nullable(isString) }),
  'set-instance-variant': shape({ id: isString, values: nullable(recordOf(nullable(isString))), previewRev: optional(isCount), previewSignature: optional(isString) }),
  'swap-instance': shape({ id: isString, target: isSwapTarget, previewRev: optional(isCount), previewSignature: optional(isString) }),
  'set-instance-override': shape({ id: isString, target: arrayOf(isString), values: isOverrideValues }),
  'reset-instance-override': shape({ id: isString, target: arrayOf(isString) }),
  'reset-instance-overrides': shape({ id: isString }),
}
const isComponentOp: Check = (value) => isRecord(value) && typeof value.op === 'string' && Object.hasOwn(COMPONENT_OPS, value.op) && COMPONENT_OPS[value.op as ComponentOp['op']](value)
const isTokenModeOp: Check = (value) => isRecord(value) && typeof value.op === 'string' && Object.hasOwn(TOKEN_MODE_OPS, value.op) && TOKEN_MODE_OPS[value.op as TokenModeOp['op']](value)

const isBoardRef = shape({ artboardId: nullable(isString), state: nullable(isString), viewport: nullable(isString) })
const isPaddingLength: Check = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
const paddingFields = { top: isPaddingLength, right: isPaddingLength, bottom: isPaddingLength, left: isPaddingLength }
const isBoardView = (value: unknown) => isBoardRef(value) && shape({ pageId: nullable(isString), name: isString, x: isNumber, y: isNumber, width: isNumber, height: isNumber, visible: isBoolean, overflow: oneOf(['clip', 'visible']), sizeOverride: isBoolean, padding: shape(paddingFields) })(value)
const placementFields = { id: isString, artboardId: isString, state: nullable(isString), viewport: nullable(isString) }
const sizeFields = { width: isNumber, height: isNumber }
const ARTBOARD_OPS: Record<ArtboardOp['op'], Check> = {
  'create-page': shape({ id: isString, name: isString, beforeId: nullable(isString) }),
  'rename-page': shape({ id: isString, name: isString }),
  'reorder-page': shape({ id: isString, beforeId: nullable(isString) }),
  'duplicate-page': shape({ id: isString, newId: isString, name: isString, idMap: isStringMap }),
  'delete-page': shape({ id: isString }),
  'create-artboard': shape({ id: isString, pageId: isString, name: isString, x: isNumber, y: isNumber, ...sizeFields, beforeId: nullable(isString), overflow: optional(oneOf(['clip', 'visible'])) }),
  'rename-artboard': shape({ id: isString, name: isString }),
  'move-artboard': shape({ id: isString, x: isNumber, y: isNumber }),
  'resize-artboard': shape({ id: isString, ...sizeFields }),
  'set-artboard-padding': value => shape({ id: isString })(value) && isRecord(value) && Object.entries(paddingFields).every(([side, check]) => !Object.hasOwn(value, side) || check(value[side])),
  'move-artboard-view': shape({ ...placementFields, x: isNumber, y: isNumber }),
  'set-artboard-view-visible': shape({ ...placementFields, visible: isBoolean }),
  'set-artboard-view-size': shape({ ...placementFields, width: nullable(isNumber), height: nullable(isNumber) }),
  'separate-artboard-view': shape({ ...placementFields, viewport: isString, ...sizeFields, expectedViewport: shape(sizeFields), restoreViewport: shape(sizeFields) }),
  'resize-viewport': shape({ name: isString, ...sizeFields }),
  'rename-viewport': shape({ name: isString, newName: isString }),
  'rename-state': shape({ name: isString, newName: isString }),
  'duplicate-artboard': shape({ id: isString, newId: isString, pageId: isString, name: isString, x: isNumber, y: isNumber, beforeId: nullable(isString), idMap: isStringMap }),
  'reorder-artboard': shape({ id: isString, pageId: isString, beforeId: nullable(isString) }),
  'delete-artboard': shape({ id: isString }),
  'upgrade-artboards': shape({ pageId: isString, artboardId: isString, name: isString, ...sizeFields, placements: arrayOf(shape({ id: isString, state: nullable(isString), viewport: nullable(isString), x: isNumber, y: isNumber })) }),
}
const isArtboardOp: Check = (value) => isRecord(value) && typeof value.op === 'string' && Object.hasOwn(ARTBOARD_OPS, value.op) && ARTBOARD_OPS[value.op as ArtboardOp['op']](value)

const CLIENT_MESSAGES: Record<ClientMessage['t'], Check> = {
  hello: shape({ protocol: isString, client: isString, author: isString, earlyResult: optional(isBoolean) }),
  view: shape({ boards: arrayOf(isBoardRef), components: isBoolean, bakeDiffs: optional(isBoolean) }),
  'preview-instance-swap': shape({ id: isString, op: (value) => isRecord(value) && ['swap-instance', 'set-instance-variant'].includes(String(value.op)) && isComponentOp(value) }),
  commit: shape({ id: isString, base: isCount, ops: arrayOf((value) => isPatchOp(value) || isPlacementOp(value) || isTokenModeOp(value) || isComponentOp(value) || isArtboardOp(value)), label: isString }),
  anchor: shape({ id: isString, name: isString }),
  undo: shape({ id: isString }),
  redo: shape({ id: isString }),
  log: shape({ id: isString, limit: isCount, before: optional(isString) }),
  activity: shape({ id: isString, limit: isCount, since: optional(isString), cursor: optional(isString) }),
}

const isEnvelope = shape({ hash: isString, prevHash: nullable(isString), author: isString, message: isString, specVersion: isString })
const isLogEntry: Check = (value) => isEnvelope(value) && shape({
  cursor: optional(isString),
  anchors: optional(arrayOf(isString)),
  anchor: optional(shape({ name: isString, targetHash: nullable(isString) })),
  time: optional(shape({ kind: oneOf(['logical']), value: isNumber })),
  wallTime: optional(nullable(isString)),
  nodeIds: optional(arrayOf(isString)),
  artboardIds: optional(arrayOf(isString)),
  pageIds: optional(arrayOf(isString)),
  nodes: optional(shape({ inserted: arrayOf(isString), removed: arrayOf(isString), changed: arrayOf(isString) })),
  sections: optional(arrayOf(shape({ section: oneOf(['tokens', 'tokenCollections', 'componentSets', 'params', 'data', 'lookups', 'states', 'viewports', 'matrix', 'namedStyles', 'components', 'annotations', 'meta']), names: arrayOf(isString) }))),
  factsComplete: optional(isBoolean),
})(value)
const isActivityEntry: Check = (value) => isLogEntry(value) && isRecord(value) && ['cursor', 'anchors', 'time', 'wallTime', 'nodeIds', 'nodes', 'sections', 'factsComplete'].every(key => value[key] !== undefined)
const isReport = arrayOf(shape({ code: isString, severity: oneOf(['error', 'warning', 'info']), message: isString, nodeId: optional(isString), detail: isAnything }))
const isHistory = shape({ canUndo: isBoolean, canRedo: isBoolean, undoLabel: nullable(isString), redoLabel: nullable(isString) })
const isCause: Check = (value) => {
  if (!isRecord(value)) return false
  if (value.kind === 'open') return true
  if (value.kind === 'external') return value.author === null || isString(value.author)
  return oneOf(['commit', 'undo', 'redo'])(value.kind) && isString(value.id) && isString(value.author)
}
const isView = shape({ rev: isCount, doc: isDocument, head: nullable(isEnvelope), history: isHistory, issues: isReport, pages: arrayOf(shape({ id: isString, name: isString, artboardIds: arrayOf(isString) })), boards: arrayOf(isBoardView), unavailableBoards: optional(arrayOf(isBoardRef)) })

const SERVICE_MESSAGES: Record<ServiceMessage['t'], Check> = {
  welcome: (value) => isView(value) && shape({ protocol: isString, path: isString, docId: nullable(isString), chain: isBoolean, created: isBoolean })(value),
  doc: (value) => isView(value) && shape({ cause: isCause })(value),
  baked: (value) => isBoardView(value) && shape({ rev: isCount, state: nullable(isString), html: isString, report: isReport })(value),
  'baked-diff': (value) => isBoardView(value) && shape({ rev: isCount, state: nullable(isString), baseRev: isCount, start: isCount, deleteCount: isCount, insert: isString, report: isReport })(value),
  component: shape({ rev: isCount, name: isString, html: isString, report: isReport }),
  'instance-swap-preview': shape({ id: isString, rev: isCount, report: shape({ signature: isString, instanceId: isString, scope: arrayOf(isString), component: isString, overrides: arrayOf(isRecord), props: arrayOf(isRecord), fills: arrayOf(isRecord) }) }),
  result: (value) =>
    isRecord(value) && isString(value.id) && (value.ok === true ? isCount(value.rev) : value.ok === false && oneOf(RESULT_CODES)(value.code) && isString(value.message)),
  log: shape({ id: isString, entries: arrayOf(isLogEntry), nextCursor: optional(nullable(isString)), latestCursor: optional(nullable(isString)), hasMore: optional(isBoolean) }),
  activity: shape({ id: isString, entries: arrayOf(isActivityEntry), frontier: isString, nextCursor: nullable(isString), hasMore: isBoolean }),
  fault: shape({ code: oneOf(FAULT_CODES), message: isString }),
}

function parseObject(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function parseTagged<T>(line: string, checks: Record<string, Check>): T | null {
  const value = parseObject(line)
  if (!value || typeof value.t !== 'string' || !Object.hasOwn(checks, value.t)) return null
  return (checks[value.t] as Check)(value) ? (value as unknown as T) : null
}

export function parseClientMessage(line: string): ClientMessage | null {
  return parseTagged<ClientMessage>(line, CLIENT_MESSAGES)
}

export function parseWireClientMessage(line: string): WireClientMessage | null {
  return parseTagged<WireClientMessage>(line, { ...CLIENT_MESSAGES, view: (value) => isRecord(value) && (('boards' in value && !('states' in value) && CLIENT_MESSAGES.view(value)) || ('states' in value && !('boards' in value) && shape({ states: arrayOf(nullable(isString)), components: isBoolean, bakeDiffs: optional(isBoolean) })(value))) })
}

export function parseServiceMessage(line: string): ServiceMessage | null {
  return parseTagged<ServiceMessage>(line, SERVICE_MESSAGES)
}
