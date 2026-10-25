import { readFileSync } from 'node:fs'
import { listDocumentImages, parseDocument } from 'foundation-engine'
import { flagString, parseArgs } from '../argv.js'
import { editDocument } from '../edit.js'
import { defaultAuthor } from '../identity.js'
import type { CliIO } from '../io.js'

export async function runImages(args: string[], io: CliIO, mode = 'images'): Promise<number> {
  const { positionals, flags } = parseArgs(args)
  const path = positionals[0]
  if (!path) { io.stderr(`usage: foundation ${mode} FILE [SOURCE] [--node ID] [--property src|background-image]`); return 2 }
  try {
    if (mode === 'images') {
      io.stdout(JSON.stringify({ path, images: listDocumentImages(parseDocument(readFileSync(path, 'utf8')).doc, path) }))
      return 0
    }
    const node = flagString(flags, 'node')
    const ops = mode === 'import-image' ? [{ op: mode, id: node, source: positionals[1], property: flagString(flags, 'property') ?? 'src' }] : [{ op: mode, ...(node ? { nodeIds: [node] } : {}) }]
    if (mode === 'import-image' && (!node || !positionals[1])) throw new Error('import-image requires SOURCE and --node ID')
    const result = await editDocument(path, ops, flagString(flags, 'label') ?? 'Store images', flagString(flags, 'author') ?? defaultAuthor(), flagString(flags, 'id'), { durable: flags.durable === true, expectedDocId: flagString(flags, 'expected-doc-id'), expectedHead: flagString(flags, 'expected-head') })
    io.stdout(JSON.stringify({ path, ...result }))
    return result.ok ? 0 : 1
  } catch (err) { io.stderr(String(err)); return 1 }
}
