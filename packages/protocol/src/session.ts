import type { EnvelopeRecord, FdnDocument, PatchOp, ReportLine } from './document.ts'

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

export type ClientMessage =
  | { t: 'hello'; protocol: string; client: string; author: string }
  | { t: 'view'; states: Array<string | null>; components: boolean }
  | { t: 'commit'; id: string; base: number; ops: PatchOp[]; label: string }
  | { t: 'undo'; id: string }
  | { t: 'redo'; id: string }
  | { t: 'log'; id: string; limit: number }

export type ServiceMessage =
  | ({ t: 'welcome'; protocol: string; path: string; docId: string | null; chain: boolean; created: boolean } & DocumentView)
  | ({ t: 'doc'; cause: Cause } & DocumentView)
  | { t: 'baked'; rev: number; state: string | null; html: string; report: ReportLine[] }
  | { t: 'component'; rev: number; name: string; html: string; report: ReportLine[] }
  | { t: 'result'; id: string; ok: true; rev: number }
  | { t: 'result'; id: string; ok: false; code: ResultCode; message: string }
  | { t: 'log'; id: string; entries: EnvelopeRecord[] }
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
const isDocument = shape({
  specVersion: isString,
  title: optional(isString),
  tokens: isStringMap,
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
  'insert-node': shape({ parent: nullable(isString), index: isInteger, node: isNode }),
  'remove-node': shape({ id: isString }),
  'move-node': shape({ id: isString, parent: nullable(isString), index: isInteger }),
  'set-attr': shape({ id: isString, key: isString, value: nullable(isString) }),
  'set-style': shape({ id: isString, prop: isString, value: nullable(isString), state: optional(isStyleState) }),
  'set-style-ref': shape({ id: isString, styleRef: nullable(isString) }),
  'set-text': shape({ id: isString, text: isString }),
  'set-when': shape({ id: isString, when: nullable(isString) }),
  'set-token': shape({ name: isString, value: nullable(isString) }),
  'set-named-style': shape({ style: isNamedStyle }),
  'remove-named-style': shape({ name: isString }),
  'set-component': shape({ component: isComponent }),
  'remove-component': shape({ name: isString }),
  'set-param': shape({ param: isParam }),
  'set-lookup': shape({ lookup: isLookup }),
  'set-state': shape({ state: isState }),
  annotate: shape({ annotation: isAnnotation }),
  'set-annotation-status': shape({ id: isString, status: isAnnotationStatus }),
  'remove-annotation': shape({ id: isString }),
  'replace-document': shape({ doc: isDocument }),
}

const isPatchOp: Check = (value) => isRecord(value) && typeof value.op === 'string' && Object.hasOwn(PATCH_OPS, value.op) && PATCH_OPS[value.op as PatchOp['op']](value)

const CLIENT_MESSAGES: Record<ClientMessage['t'], Check> = {
  hello: shape({ protocol: isString, client: isString, author: isString }),
  view: shape({ states: arrayOf(nullable(isString)), components: isBoolean }),
  commit: shape({ id: isString, base: isCount, ops: arrayOf(isPatchOp), label: isString }),
  undo: shape({ id: isString }),
  redo: shape({ id: isString }),
  log: shape({ id: isString, limit: isCount }),
}

const isEnvelope = shape({ hash: isString, prevHash: nullable(isString), author: isString, message: isString, specVersion: isString })
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
  log: shape({ id: isString, entries: arrayOf(isEnvelope) }),
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
