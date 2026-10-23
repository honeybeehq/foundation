import type { ChainLogEntry, EnvelopeRecord, FdnDocument, InstanceOverridePatch, PatchOp, ReportLine } from './document.ts'

export type { EnvelopeRecord, FdnDocument, FdnNode, PatchOp, ReportLine } from './document.ts'

export const SESSION_PROTOCOL = '0.1'

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

export type ComponentOp =
  | { op: 'set-instance-variant'; id: string; values: Record<string, string | null> | null }
  | { op: 'set-instance-override'; id: string; target: string[]; values: InstanceOverridePatch }
  | { op: 'reset-instance-override'; id: string; target: string[] }
  | { op: 'reset-instance-overrides'; id: string }

export type SessionOp = PatchOp | PlacementOp | TokenModeOp | ComponentOp

export type ClientMessage =
  | { t: 'hello'; protocol: string; client: string; author: string }
  | { t: 'view'; states: Array<string | null>; components: boolean }
  | { t: 'commit'; id: string; base: number; ops: SessionOp[]; label: string }
  | { t: 'anchor'; id: string; name: string }
  | { t: 'undo'; id: string }
  | { t: 'redo'; id: string }
  | { t: 'log'; id: string; limit: number; before?: string }

export type ServiceMessage =
  | ({ t: 'welcome'; protocol: string; path: string; docId: string | null; chain: boolean; created: boolean } & DocumentView)
  | ({ t: 'doc'; cause: Cause } & DocumentView)
  | { t: 'baked'; rev: number; state: string | null; html: string; report: ReportLine[] }
  | { t: 'component'; rev: number; name: string; html: string; report: ReportLine[] }
  | { t: 'result'; id: string; ok: true; rev: number }
  | { t: 'result'; id: string; ok: false; code: ResultCode; message: string }
  | { t: 'log'; id: string; entries: Array<EnvelopeRecord & Partial<Omit<ChainLogEntry, keyof EnvelopeRecord>>>; nextCursor?: string | null; latestCursor?: string | null; hasMore?: boolean }
  | { t: 'fault'; code: FaultCode; message: string }

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
  'set-title': shape({ title: nullable(isString) }),
  'insert-node': shape({ parent: nullable(isString), index: isInteger, node: isNode }),
  'remove-node': shape({ id: isString }),
  'move-node': shape({ id: isString, parent: nullable(isString), index: isInteger }),
  'set-attr': shape({ id: isString, key: isString, value: nullable(isString) }),
  'set-style': shape({ id: isString, prop: isString, value: nullable(isString), state: optional(isStyleState) }),
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
  'set-lookup': shape({ lookup: isLookup, index: optional(isCount) }),
  'remove-lookup': shape({ name: isString }),
  'set-state': shape({ state: isState, index: optional(isCount) }),
  'remove-state': shape({ name: isString }),
  'set-data': shape({ data: isDataSet, index: optional(isCount) }),
  'remove-data': shape({ name: isString }),
  'set-viewport': shape({ viewport: isViewport, index: optional(isCount) }),
  'remove-viewport': shape({ name: isString }),
  'set-matrix': shape({ cells: arrayOf(shape({ state: isString, viewport: isString })) }),
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
  'set-instance-variant': shape({ id: isString, values: nullable(recordOf(nullable(isString))) }),
  'set-instance-override': shape({ id: isString, target: arrayOf(isString), values: isOverrideValues }),
  'reset-instance-override': shape({ id: isString, target: arrayOf(isString) }),
  'reset-instance-overrides': shape({ id: isString }),
}
const isComponentOp: Check = (value) => isRecord(value) && typeof value.op === 'string' && Object.hasOwn(COMPONENT_OPS, value.op) && COMPONENT_OPS[value.op as ComponentOp['op']](value)
const isTokenModeOp: Check = (value) => isRecord(value) && typeof value.op === 'string' && Object.hasOwn(TOKEN_MODE_OPS, value.op) && TOKEN_MODE_OPS[value.op as TokenModeOp['op']](value)

const CLIENT_MESSAGES: Record<ClientMessage['t'], Check> = {
  hello: shape({ protocol: isString, client: isString, author: isString }),
  view: shape({ states: arrayOf(nullable(isString)), components: isBoolean }),
  commit: shape({ id: isString, base: isCount, ops: arrayOf((value) => isPatchOp(value) || isPlacementOp(value) || isTokenModeOp(value) || isComponentOp(value)), label: isString }),
  anchor: shape({ id: isString, name: isString }),
  undo: shape({ id: isString }),
  redo: shape({ id: isString }),
  log: shape({ id: isString, limit: isCount, before: optional(isString) }),
}

const isEnvelope = shape({ hash: isString, prevHash: nullable(isString), author: isString, message: isString, specVersion: isString })
const isLogEntry: Check = (value) => isEnvelope(value) && shape({
  cursor: optional(isString),
  anchors: optional(arrayOf(isString)),
  anchor: optional(shape({ name: isString, targetHash: nullable(isString) })),
  time: optional(shape({ kind: oneOf(['logical']), value: isNumber })),
  wallTime: optional(nullable(isString)),
  nodeIds: optional(arrayOf(isString)),
  nodes: optional(shape({ inserted: arrayOf(isString), removed: arrayOf(isString), changed: arrayOf(isString) })),
  sections: optional(arrayOf(shape({ section: oneOf(['tokens', 'tokenCollections', 'componentSets', 'params', 'data', 'lookups', 'states', 'viewports', 'matrix', 'namedStyles', 'components', 'annotations', 'meta']), names: arrayOf(isString) }))),
  factsComplete: optional(isBoolean),
})(value)
const isReport = arrayOf(shape({ code: isString, severity: oneOf(['error', 'warning', 'info']), message: isString, nodeId: optional(isString), detail: isAnything }))
const isHistory = shape({ canUndo: isBoolean, canRedo: isBoolean, undoLabel: nullable(isString), redoLabel: nullable(isString) })
const isCause: Check = (value) => {
  if (!isRecord(value)) return false
  if (value.kind === 'open') return true
  if (value.kind === 'external') return value.author === null || isString(value.author)
  return oneOf(['commit', 'undo', 'redo'])(value.kind) && isString(value.id) && isString(value.author)
}
const isView = shape({ rev: isCount, doc: isDocument, head: nullable(isEnvelope), history: isHistory, issues: isReport })

const SERVICE_MESSAGES: Record<ServiceMessage['t'], Check> = {
  welcome: (value) => isView(value) && shape({ protocol: isString, path: isString, docId: nullable(isString), chain: isBoolean, created: isBoolean })(value),
  doc: (value) => isView(value) && shape({ cause: isCause })(value),
  baked: shape({ rev: isCount, state: nullable(isString), html: isString, report: isReport }),
  component: shape({ rev: isCount, name: isString, html: isString, report: isReport }),
  result: (value) =>
    isRecord(value) && isString(value.id) && (value.ok === true ? isCount(value.rev) : value.ok === false && oneOf(RESULT_CODES)(value.code) && isString(value.message)),
  log: shape({ id: isString, entries: arrayOf(isLogEntry), nextCursor: optional(nullable(isString)), latestCursor: optional(nullable(isString)), hasMore: optional(isBoolean) }),
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

export function parseServiceMessage(line: string): ServiceMessage | null {
  return parseTagged<ServiceMessage>(line, SERVICE_MESSAGES)
}
