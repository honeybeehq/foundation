import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { PNG } from 'pngjs'
import { parseDocument } from 'foundation-engine'
import type { ConformanceReport, FdnDocument, FdnViewport } from 'foundation-engine'
import type { CliIO } from '../io.js'
import { flagString, parseArgs } from '../argv.js'

interface LayoutEntry {
  id: string
  x: number
  y: number
  width: number
  height: number
}

interface RenderCell {
  artboardId?: string
  state: string | null
  viewport: FdnViewport
  png: Uint8Array
  layout: LayoutEntry[]
  report: ConformanceReport
}

interface RenderModule {
  renderDocument: (doc: FdnDocument, opts?: { state?: string; viewport?: string; artboardId?: string; pageId?: string; matrix?: boolean; deviceScaleFactor?: number; clipToViewport?: boolean }) => Promise<RenderCell[]>
}

const RENDER_MODULE_SPEC = ['foundation-engine', 'src', 'render', 'index.js'].join('/')

async function loadRenderModule(): Promise<RenderModule | undefined> {
  try {
    const mod = (await import(RENDER_MODULE_SPEC)) as Partial<RenderModule>
    if (typeof mod.renderDocument !== 'function') return undefined
    return mod as RenderModule
  } catch {
    return undefined
  }
}

export async function runRender(args: string[], io: CliIO): Promise<number> {
  const { positionals, flags } = parseArgs(args)
  const file = positionals[0]
  if (!file) {
    io.stderr('usage: foundation render <file> [--state S] [--viewport V] [--scale 1..4] [-o dir | --out file.png] [--json]')
    return 2
  }

  const renderModule = await loadRenderModule()
  if (!renderModule) {
    io.stderr('render module not available yet')
    return 2
  }

  let source: string
  try {
    source = readFileSync(file, 'utf8')
  } catch (err) {
    io.stderr(`could not read ${file}: ${err instanceof Error ? err.message : String(err)}`)
    return 2
  }

  const state = flagString(flags, 'state')
  const artboardId = flagString(flags, 'artboard')
  const pageId = flagString(flags, 'page')
  const viewport = flagString(flags, 'viewport')
  const outFile = flagString(flags, 'out')
  const outDir = flagString(flags, 'o', 'output')
  const scaleValue = flagString(flags, 'scale')
  const scale = scaleValue === undefined ? 1 : Number(scaleValue)
  if ((flags.scale !== undefined && scaleValue === undefined) || !Number.isFinite(scale) || scale < 1 || scale > 4) {
    io.stderr('scale must be a finite number between 1 and 4')
    return 2
  }
  if (flags.out !== undefined && !outFile) {
    io.stderr('--out requires a PNG file path')
    return 2
  }
  if (outFile && outDir) {
    io.stderr('use either --out file.png or -o dir')
    return 2
  }

  const { doc } = parseDocument(source)
  if (outFile && state !== undefined && !doc.states.some((entry) => entry.name === state)) {
    io.stderr(`unknown state "${state}"`)
    return 2
  }
  if (outFile && viewport !== undefined && !doc.viewports.some((entry) => entry.name === viewport)) {
    io.stderr(`unknown viewport "${viewport}"`)
    return 2
  }

  try {
    const cells = await renderModule.renderDocument(doc, {
      ...(state !== undefined ? { state } : {}),
      ...(viewport !== undefined ? { viewport } : {}),
      ...(artboardId !== undefined ? { artboardId } : {}),
      ...(pageId !== undefined ? { pageId } : {}),
      matrix: flags.matrix === true,
      deviceScaleFactor: scale,
      clipToViewport: outFile !== undefined,
    })
    if (outFile) {
      if (cells.length !== 1) {
        io.stderr(`expected exactly one state/viewport cell, found ${cells.length}`)
        return 2
      }
      const cell = cells[0]!
      const { width, height } = PNG.sync.read(Buffer.from(cell.png))
      const path = resolve(outFile)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, cell.png)
      io.stdout(JSON.stringify({ path, width, height, scale, ...(cell.artboardId === undefined ? {} : { artboardId: cell.artboardId }) }))
      return 0
    }

    if (outDir) mkdirSync(outDir, { recursive: true })

    const manifest: Array<{ label: string; artboardId?: string; state: string | null; viewport: string }> = []
    const labels = new Set<string>()
    for (const cell of cells) {
      const label = cell.artboardId === undefined ? `${cell.state ?? 'default'}--${cell.viewport.name}` : [cell.artboardId, cell.state ?? 'default', cell.viewport.name].map(encodeURIComponent).join('--')
      if (labels.has(label)) throw new Error('export filename collision; use distinct artboard/state/viewport selectors')
      labels.add(label)
      manifest.push({ label, artboardId: cell.artboardId, state: cell.state, viewport: cell.viewport.name })
      if (outDir) {
        writeFileSync(join(outDir, `${label}.png`), cell.png)
        writeFileSync(join(outDir, `${label}.layout.json`), JSON.stringify(cell.layout, null, 2))
        io.stdout(`wrote ${join(outDir, `${label}.png`)}`)
      } else {
        io.stdout(`${label}: ${cell.png.byteLength} bytes, ${cell.layout.length} layout entries`)
      }
    }

    if (outDir && cells.some(cell => cell.artboardId !== undefined)) writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    return 0
  } catch (err) {
    io.stderr(err instanceof Error ? err.message : String(err))
    return 1
  }
}
