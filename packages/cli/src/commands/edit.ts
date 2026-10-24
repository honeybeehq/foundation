import { readFileSync } from 'node:fs'
import { parseArgs, flagString } from '../argv.js'
import { editDocument } from '../edit.js'
import { defaultAuthor } from '../identity.js'
import type { CliIO } from '../io.js'

export async function runEdit(args: string[], io: CliIO): Promise<number> {
  const { positionals, flags } = parseArgs(args)
  const path = positionals[0]
  const source = flagString(flags, 'ops')
  const file = flagString(flags, 'ops-file')
  if (!path || (source === undefined) === (file === undefined)) { io.stderr('usage: foundation edit FILE --ops JSON | --ops-file FILE [--label TEXT] [--author ID]'); return 2 }
  try {
    const ops = JSON.parse(source ?? readFileSync(file === '-' ? 0 : file!, 'utf8'))
    if (!Array.isArray(ops)) throw new Error('ops must be an array')
    const result = await editDocument(path, ops, flagString(flags, 'label') ?? 'Edit', flagString(flags, 'author') ?? defaultAuthor(), flagString(flags, 'id'), { durable: flags.durable === true, expectedDocId: flagString(flags, 'expected-doc-id'), expectedHead: flagString(flags, 'expected-head') })
    io.stdout(JSON.stringify({ path, ...result }))
    return result.ok ? 0 : 1
  } catch (err) { io.stderr(String(err)); return 1 }
}
