/**
 * `foundation bake <file> [--state S] [-o out]` — write baked html to -o or
 * stdout (API.md CLI section).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { bakeDocument, parseDocument } from 'foundation-engine'
import type { CliIO } from '../io.js'
import { flagString, parseArgs } from '../argv.js'

export async function runBake(args: string[], io: CliIO): Promise<number> {
  const { positionals, flags } = parseArgs(args)
  const file = positionals[0]
  if (!file) {
    io.stderr('usage: foundation bake <file> [--state S] [--viewport V] [-o out]')
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
  const viewport = flagString(flags, 'viewport')
  const out = flagString(flags, 'o', 'out', 'output')

  const { doc } = parseDocument(source)
  const baked = bakeDocument(doc, { ...(state !== undefined ? { state } : {}), ...(artboardId !== undefined ? { artboardId } : {}), ...(viewport !== undefined ? { viewport } : {}) })

  for (const line of baked.report.lines) {
    io.stderr(`${line.severity} ${line.code}: ${line.message}`)
  }

  if (baked.report.lines.some(line => ['ambiguous-artboard', 'unknown-artboard', 'unknown-viewport', 'invalid-artboard-geometry', 'invalid-artboard-padding'].includes(line.code))) return 2

  if (out) {
    writeFileSync(out, baked.html, 'utf8')
    io.stdout(`wrote ${out}`)
  } else {
    io.stdout(baked.html)
  }

  return 0
}
