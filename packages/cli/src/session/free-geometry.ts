import type { FdnDocument, FdnNode } from 'foundation-engine'
import type { FreeBounds, HorizontalConstraint, VerticalConstraint } from 'foundation-protocol'

type FreeTransform = { degrees: number; x: boolean; y: boolean; centerX: boolean; centerY: boolean }
const NUMBER = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?'
const CANONICAL = new RegExp(`^translate\\((0%|-50%),\\s*(0%|-50%)\\) rotate\\((${NUMBER})deg\\) scale\\((-?1),\\s*(-?1)\\)$`, 'i')
const ROTATE = new RegExp(`^rotate\\((${NUMBER})deg\\)$`, 'i')
const SCALE = /^scale\((-?1)(?:,\s*(-?1))?\)$/
const PIXELS = new RegExp(`^(${NUMBER})px$`, 'i')

export function effectiveStyle(doc: FdnDocument, node: FdnNode): Record<string, string> {
  return { ...doc.namedStyles.find((style) => style.name === node.styleRef)?.style, ...node.style }
}

export function isCanonicalTransform(value: string | undefined): boolean {
  return value !== undefined && CANONICAL.test(value.trim())
}

export function freeTransform(style: Record<string, string>): FreeTransform {
  for (const key of ['rotate', 'scale', 'translate']) {
    if (style[key] && style[key] !== 'none') throw new Error(`individual CSS ${key} is not supported by free transform operations; flatten it first`)
  }
  if (style['transform-box'] && style['transform-box'] !== 'border-box') throw new Error('free transform operations require a border-box transform reference')
  if (style['transform-origin'] && !['center', 'center center', '50% 50%'].includes(style['transform-origin'])) throw new Error('free transform operations require the default centre transform origin')
  const value = style.transform?.trim() ?? 'none'
  const defaults = { degrees: 0, x: false, y: false, centerX: false, centerY: false }
  if (value === 'none' || value === '') return defaults
  const canonical = CANONICAL.exec(value)
  if (canonical) return { degrees: Number(canonical[3]), x: canonical[4] === '-1', y: canonical[5] === '-1', centerX: canonical[1] === '-50%', centerY: canonical[2] === '-50%' }
  const rotate = ROTATE.exec(value)
  if (rotate && Number.isFinite(Number(rotate[1]))) return { ...defaults, degrees: Number(rotate[1]) }
  const scale = SCALE.exec(value)
  if (scale) return { ...defaults, x: scale[1] === '-1', y: (scale[2] ?? scale[1]) === '-1' }
  throw new Error('unsupported CSS transform; free operations accept none, rotate(deg), unit flips, or the canonical translate/rotate/scale form')
}

export function canonicalTransform(style: Record<string, string>): FreeTransform | undefined {
  if (!isCanonicalTransform(style.transform)) return undefined
  try { const parsed = freeTransform(style); return Number.isFinite(parsed.degrees) ? parsed : undefined } catch { return undefined }
}

export function hasStateStyles(doc: FdnDocument, node: FdnNode): boolean {
  const named = doc.namedStyles.find((style) => style.name === node.styleRef)
  return [node.styleStates, named?.styleStates ?? {}].some((planes) => Object.values(planes).some((plane) => plane && Object.keys(plane).length > 0))
}

export function transformStyle(transform: FreeTransform): Record<string, string> {
  if (!Number.isFinite(transform.degrees)) throw new Error('rotation must be finite')
  return { transform: `translate(${transform.centerX ? '-50%' : '0%'}, ${transform.centerY ? '-50%' : '0%'}) rotate(${transform.degrees}deg) scale(${transform.x ? -1 : 1}, ${transform.y ? -1 : 1})`, 'transform-origin': '50% 50%', 'transform-box': 'border-box' }
}

function px(value: string | undefined): number | undefined {
  if (value === '0') return 0
  const match = PIXELS.exec(value ?? '')
  return match && Number.isFinite(Number(match[1])) ? Number(match[1]) : undefined
}

export function constraintsOf(style: Record<string, string>, transform: FreeTransform): { h: HorizontalConstraint; v: VerticalConstraint } {
  const axis = (start: string, end: string, size: string, center: boolean): string => {
    if (center) return 'center'
    if (style[start]?.endsWith('%') && style[size]?.endsWith('%')) return 'scale'
    if (style[size] === 'auto' && style[start] !== undefined && style[start] !== 'auto' && style[end] !== undefined && style[end] !== 'auto') return `${start}-${end}`
    if (style[start] === 'auto' && style[end] !== undefined && style[end] !== 'auto') return end
    return start
  }
  return { h: axis('left', 'right', 'width', transform.centerX) as HorizontalConstraint, v: axis('top', 'bottom', 'height', transform.centerY) as VerticalConstraint }
}

export function freeBounds(style: Record<string, string>, frame: Record<string, string>, supplied?: FreeBounds, stateful = false): FreeBounds {
  if (supplied) {
    if (![supplied.x, supplied.y, supplied.width, supplied.height, supplied.frameWidth, supplied.frameHeight].every(Number.isFinite) || supplied.width < 0 || supplied.height < 0 || supplied.frameWidth <= 0 || supplied.frameHeight <= 0) throw new Error('bounds need finite x/y, nonnegative width/height and positive frameWidth/frameHeight')
    return { ...supplied }
  }
  const frameWidth = px(frame.width), frameHeight = px(frame.height)
  const ambiguousFrame = Object.entries(frame).some(([key, value]) => /^(padding|border(?!.*radius)|overflow|writing-mode|direction|min-|max-|flex-)/.test(key) && !(key.startsWith('max-') ? value === 'none' : key === 'flex-basis' ? value === 'auto' : ['0', '0px', 'none', 'normal', 'visible', 'horizontal-tb', 'ltr'].includes(value)))
  const ambiguousChild = Object.entries(style).some(([key, value]) => /^(min-|max-|margin|padding|border(?!.*radius))/.test(key) && !(key.startsWith('max-') ? value === 'none' : ['0', '0px', 'none'].includes(value)))
  if (frameWidth === undefined || frameHeight === undefined || frame.flex !== 'none' || /grid/.test(frame.display ?? '') || stateful || Object.entries(style).some(([key, value]) => (key.startsWith('inset') || key.startsWith('grid-')) && value !== 'auto') || ambiguousFrame || ambiguousChild || style['box-sizing'] !== 'border-box') throw new Error('caller-measured bounds are required for this frame and child geometry')
  const transform = freeTransform(style)
  const resolveAxis = (start: string, end: string, size: string, extent: number, centered: boolean): [number, number] => {
    const percent = (value: string | undefined) => value?.endsWith('%') && Number.isFinite(Number(value.slice(0, -1))) ? extent * Number(value.slice(0, -1)) / 100 : undefined
    const leading = px(style[start]), trailing = px(style[end])
    const length = px(style[size]) ?? percent(style[size]) ?? (style[size] === 'auto' && leading !== undefined && trailing !== undefined ? extent - leading - trailing : undefined)
    const center = new RegExp(`^calc\\(50% \\+ (${NUMBER})px\\)$`, 'i').exec(style[start] ?? '')
    const position = leading ?? percent(style[start]) ?? (center ? extent / 2 + Number(center[1]) : style[start] === 'auto' && trailing !== undefined && length !== undefined ? extent - trailing - length : undefined)
    if (length === undefined || position === undefined || !Number.isFinite(length) || !Number.isFinite(position)) throw new Error('caller-measured bounds are required for noncanonical free geometry')
    return [position - (centered ? length / 2 : 0), length]
  }
  const [x, width] = resolveAxis('left', 'right', 'width', frameWidth, transform.centerX)
  const [y, height] = resolveAxis('top', 'bottom', 'height', frameHeight, transform.centerY)
  return freeBounds(style, frame, { x, y, width, height, frameWidth, frameHeight })
}

function numeric(value: number): string {
  if (!Number.isFinite(value)) throw new Error('free constraint calculation exceeds finite CSS geometry')
  return String(value)
}

export function constraintStyle(bounds: FreeBounds, h: HorizontalConstraint, v: VerticalConstraint, transform: FreeTransform): Record<string, string> {
  const axis = (start: string, end: string, size: string, mode: string, position: number, length: number, extent: number): Record<string, string> => {
    if (mode === end) return { [start]: 'auto', [end]: `${numeric(extent - position - length)}px`, [size]: `${numeric(length)}px` }
    if (mode === `${start}-${end}`) return { [start]: `${numeric(position)}px`, [end]: `${numeric(extent - position - length)}px`, [size]: 'auto' }
    if (mode === 'center') return { [start]: `calc(50% + ${numeric(position + length / 2 - extent / 2)}px)`, [end]: 'auto', [size]: `${numeric(length)}px` }
    if (mode === 'scale') return { [start]: `${numeric(position / extent * 100)}%`, [end]: 'auto', [size]: `${numeric(length / extent * 100)}%` }
    if (mode !== start) throw new Error(`unknown free constraint "${mode}"`)
    return { [start]: `${numeric(position)}px`, [end]: 'auto', [size]: `${numeric(length)}px` }
  }
  return {
    ...axis('left', 'right', 'width', h, bounds.x, bounds.width, bounds.frameWidth),
    ...axis('top', 'bottom', 'height', v, bounds.y, bounds.height, bounds.frameHeight),
    ...transformStyle({ ...transform, centerX: h === 'center', centerY: v === 'center' }),
    'grid-area': 'auto', 'grid-row': 'auto', 'grid-column': 'auto',
    'grid-row-start': 'auto', 'grid-row-end': 'auto', 'grid-column-start': 'auto', 'grid-column-end': 'auto',
    'box-sizing': 'border-box', 'margin-top': '0px', 'margin-right': '0px', 'margin-bottom': '0px', 'margin-left': '0px',
  }
}
