import { rememberAuthored } from '../history-origin.js'
import { selectedChainFormat } from '../chain-format.js'
import { loadChain } from '../chain-cache.js'
import { randomUUID } from 'node:crypto'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createChain, normalizeDocument, parseDocument } from 'foundation-engine'
import type { CliIO } from '../io.js'
import { flagString, parseArgs } from '../argv.js'
import { readDocIdAttr } from '../docid.js'
import { canonicalText, documentText, readBytesIfPresent } from '../disk.js'
import { withWallTime } from '../change-meta.js'
import { defaultAuthor } from '../identity.js'

function writeCopy(path: string, text: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = mkdtempSync(join(dirname(path), '.foundation-copy-'))
  const tempDoc = join(temp, 'document')
  const tempChain = join(temp, 'chain')
  let publishedChain = false
  try {
    writeFileSync(tempDoc, text)
    writeFileSync(tempChain, bytes)
    linkSync(tempChain, `${path}.chain`)
    publishedChain = true
    linkSync(tempDoc, path)
  } catch (err) {
    if (publishedChain) unlinkSync(`${path}.chain`)
    throw err
  } finally {
    for (const file of [tempDoc, tempChain]) {
      if (existsSync(file)) unlinkSync(file)
    }
    rmdirSync(temp)
  }
}

export async function runCopy(args: string[], io: CliIO): Promise<number> {
  const { positionals, flags } = parseArgs(args)
  const [src, dest] = positionals
  if (!src || !dest || positionals.length !== 2 || flags.title === true) {
    io.stderr('usage: foundation copy <src> <dest> [--title T] [--json]')
    return 2
  }
  const sourcePath = resolve(src)
  const path = resolve(dest.endsWith('.fdn.html') ? dest : `${dest}.fdn.html`)
  const chainPath = `${path}.chain`
  if (existsSync(path) || existsSync(chainPath)) {
    io.stderr(`refusing to overwrite existing file: ${existsSync(path) ? path : chainPath}`)
    return 2
  }

  try {
    const sourceText = readFileSync(sourcePath, 'utf8')
    const sourceBytes = readBytesIfPresent(`${sourcePath}.chain`)
    const sourceChain = sourceBytes ? loadChain(sourceBytes) : null
    if (sourceChain && !sourceChain.verify().ok) throw new Error(`source chain failed verification: ${sourcePath}.chain`)
    const stampedId = readDocIdAttr(sourceText)
    const chainId = sourceChain?.docId() ?? null
    if (stampedId && chainId && stampedId !== chainId) {
      throw new Error('source document and chain have different document ids')
    }
    const parsed = parseDocument(sourceText)
    const malformedSet = parsed.report.lines.find((line) => ['malformed-component-set', 'malformed-instance-overrides', 'misplaced-override-wrapper'].includes(line.code))
    if (malformedSet) throw new Error(malformedSet.message)
    const doc = normalizeDocument(parsed.doc)
    const source = {
      path: sourcePath,
      docId: chainId ?? stampedId,
      head: sourceChain?.head().hash ?? null,
      dirty: sourceChain !== null && canonicalText(doc) !== canonicalText(parseDocument(canonicalText(sourceChain.doc())).doc),
    }
    const title = flagString(flags, 'title')
    if (title !== undefined) doc.title = title
    const docId = randomUUID()
    const message = `copied from ${source.docId ?? 'unidentified'}@${source.head ?? 'untracked'}${source.dirty ? '+working' : ''} (${sourcePath})`
    const chain = createChain(doc, withWallTime({ author: defaultAuthor(), message }), { docId })
    writeCopy(path, documentText(doc, docId), chain.save({ format: selectedChainFormat(path) }))
    rememberAuthored(chain)
    const result = { path, docId, chainPath, head: chain.head().hash, source }
    io.stdout(flags.json ? JSON.stringify(result) : `copied ${sourcePath} to ${path} (docId ${docId})`)
    return 0
  } catch (err) {
    io.stderr(err instanceof Error ? err.message : String(err))
    return (err as NodeJS.ErrnoException)?.code === 'EEXIST' ? 2 : 1
  }
}
