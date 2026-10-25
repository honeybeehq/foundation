import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FdnDocument, FdnNode } from '../types.js'

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export interface ImageAsset { src: string; mime: string; bytes: number; hash: string }
export interface DocumentImage { nodeId: string; property: string; src: string; sourceUrl: string | null; stored: boolean; mime: string | null; bytes: number | null; hash: string | null }
export const ASSET_REFERENCE = /^\.foundation\/assets\/([a-f0-9]{64})\.(png|jpg|gif|webp|avif|svg)$/

export function sniffImage(bytes: Uint8Array): { mime: string; ext: string } {
  const b = Buffer.from(bytes)
  if (!b.length || b.length > MAX_IMAGE_BYTES) throw new Error('image must contain 1 to 20 MiB of bytes')
  if (b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { mime: 'image/png', ext: 'png' }
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return { mime: 'image/jpeg', ext: 'jpg' }
  if (/^GIF8[79]a$/.test(b.subarray(0, 6).toString())) return { mime: 'image/gif', ext: 'gif' }
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', ext: 'webp' }
  if (b.subarray(4, 8).toString() === 'ftyp' && /avif|avis/.test(b.subarray(8, 32).toString())) return { mime: 'image/avif', ext: 'avif' }
  const text = b.toString('utf8').replace(/^\uFEFF/, '').trimStart()
  if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)) {
    if (/<script\b|<foreignObject\b|\bon\w+\s*=|(?:href|src)\s*=\s*["']\s*(?!#|data:)|url\(\s*["']?\s*(?!#|data:)/i.test(text)) throw new Error('SVG must be self-contained without scripts or external resources')
    return { mime: 'image/svg+xml', ext: 'svg' }
  }
  throw new Error('unsupported image content')
}

function localBytes(path: string): Buffer {
  if (statSync(path).size > MAX_IMAGE_BYTES) throw new Error('image exceeds 20 MiB')
  const bytes = readFileSync(path)
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('image exceeds 20 MiB')
  return bytes
}

export async function readImage(source: string, documentPath: string): Promise<Buffer> {
  if (source.startsWith('data:')) {
    if (source.length > MAX_IMAGE_BYTES * 4) throw new Error('image exceeds 20 MiB')
    const match = /^data:([^,]*),(.*)$/s.exec(source)
    if (!match) throw new Error('invalid data URI')
    const bytes = /;base64$/i.test(match[1]!) ? Buffer.from(match[2]!, 'base64') : Buffer.from(decodeURIComponent(match[2]!))
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('image exceeds 20 MiB')
    return bytes
  }
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, { signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`image fetch failed: HTTP ${response.status}`)
    if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) { await response.body?.cancel(); throw new Error('image exceeds 20 MiB') }
    if (!response.body) throw new Error('image response has no body')
    const chunks: Uint8Array[] = []
    let length = 0
    const reader = response.body.getReader()
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        length += next.value.length
        if (length > MAX_IMAGE_BYTES) throw new Error('image exceeds 20 MiB')
        chunks.push(next.value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    return Buffer.concat(chunks)
  }
  if (/^[a-z][\w+.-]*:/i.test(source) && !source.startsWith('file:')) throw new Error('unsupported image source scheme')
  return localBytes(source.startsWith('file:') ? fileURLToPath(source) : resolve(dirname(documentPath), source))
}

export function storeImageBytes(documentPath: string, bytes: Uint8Array): ImageAsset {
  const { mime, ext } = sniffImage(bytes)
  const hash = createHash('sha256').update(bytes).digest('hex')
  const src = `.foundation/assets/${hash}.${ext}`
  const root = realpathSync(dirname(resolve(documentPath)))
  const directory = resolve(root, '.foundation/assets')
  mkdirSync(directory, { recursive: true })
  if (realpathSync(directory) !== directory) throw new Error('asset store must not contain symlinks')
  const path = resolve(root, src)
  if (existsSync(path)) {
    const current = localBytes(path)
    if (createHash('sha256').update(current).digest('hex') !== hash) throw new Error('asset hash mismatch')
  } else {
    const temporary = `${path}.${randomUUID()}.tmp`
    try { writeFileSync(temporary, bytes, { flag: 'wx' }); renameSync(temporary, path) } finally { if (existsSync(temporary)) unlinkSync(temporary) }
  }
  return { src, mime, bytes: bytes.length, hash }
}

export async function importImage(documentPath: string, source: string): Promise<ImageAsset> {
  return storeImageBytes(documentPath, await readImage(source, documentPath))
}

export function imageNodes(doc: FdnDocument): FdnNode[] {
  const result: FdnNode[] = []
  const walk = (nodes: FdnNode[]) => { for (const node of nodes) { result.push(node); walk(node.children) } }
  walk(doc.body)
  for (const component of doc.components) walk(component.body)
  return result
}

export function imageSources(node: FdnNode): Array<{ property: string; src: string }> {
  const result: Array<{ property: string; src: string }> = []
  if (node.tag === 'img' && node.attrs.src) result.push({ property: 'src', src: node.attrs.src })
  for (const [property, value] of Object.entries(node.style)) {
    if (property !== 'background-image' && property !== 'background') continue
    for (const match of value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g)) result.push({ property, src: match[1] ?? match[2] ?? match[3]! })
  }
  return result
}

export function listDocumentImages(doc: FdnDocument, documentPath: string): DocumentImage[] {
  return imageNodes(doc).flatMap(node => imageSources(node).map(image => {
    let mime: string | null = null
    let bytes: number | null = null
    let stored = false
    if (ASSET_REFERENCE.test(image.src)) {
      try {
        const content = localBytes(resolve(dirname(documentPath), image.src))
        mime = sniffImage(content).mime
        bytes = content.length
        stored = createHash('sha256').update(content).digest('hex') === ASSET_REFERENCE.exec(image.src)![1]
      } catch {}
    }
    return { nodeId: node.id, ...image, sourceUrl: node.attrs['data-fdn-source-url'] ?? null, stored, mime, bytes, hash: stored ? ASSET_REFERENCE.exec(image.src)![1]! : null }
  }))
}

export function embedDocumentImages(doc: FdnDocument, documentPath: string): FdnDocument {
  const result = structuredClone(doc)
  for (const node of imageNodes(result)) for (const image of imageSources(node)) {
    if (/^(?:https?:|data:|blob:|#)/i.test(image.src)) continue
    let bytes: Buffer
    let mime: string
    try {
      const source = image.src.split(/[?#]/, 1)[0]!
      bytes = localBytes(source.startsWith('file:') ? fileURLToPath(source) : resolve(dirname(documentPath), decodeURIComponent(source)))
      mime = sniffImage(bytes).mime
    } catch (err) {
      if (ASSET_REFERENCE.test(image.src)) throw err
      continue
    }
    if (ASSET_REFERENCE.test(image.src) && createHash('sha256').update(bytes).digest('hex') !== ASSET_REFERENCE.exec(image.src)![1]) throw new Error('asset hash mismatch')
    const source = `data:${mime};base64,${bytes.toString('base64')}`
    if (image.property === 'src') node.attrs.src = source
    else node.style[image.property] = node.style[image.property]!.replace(image.src, source)
  }
  return result
}

export function copyDocumentImages(doc: FdnDocument, sourcePath: string, destinationPath: string): void {
  for (const image of listDocumentImages(doc, sourcePath)) if (ASSET_REFERENCE.test(image.src)) {
    if (!image.stored) throw new Error(`missing or invalid asset: ${image.src}`)
    storeImageBytes(destinationPath, localBytes(resolve(dirname(sourcePath), image.src)))
  }
}
