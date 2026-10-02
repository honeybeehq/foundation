/**
 * `foundation ingest <file> [--commit [-m msg] [--author A]]` — normalize in
 * place: parse -> project, write the canonical text back over the file,
 * print the NormalizationReport lines (API.md CLI section). This is D4's
 * "text editing is an input method": any hand-edited `.fdn.html` gets
 * ingested back to canonical form.
 *
 * `--commit` extends that into the chain (D2): when `<file>.chain` exists,
 * the freshly-parsed document is appended as ONE change, made of the
 * PatchOps that turn the chain's document into the parsed one (falling back
 * to `replace-document` when the op vocabulary cannot express the edit). A
 * no-op ingest (parsed doc canonically identical to the chain's current doc)
 * is detected and the commit is skipped — an empty envelope would be a lie
 * about authorship having happened. The chain is written before the text,
 * both atomically, so a live `foundation session` never sees the new text
 * without its chain.
 */
import { existsSync, readFileSync } from 'node:fs'
import { parseDocument, projectDocument, validateDocument } from 'foundation-engine'
import type { NormalizationReport } from 'foundation-engine'
import type { CliIO } from '../io.js'
import { flagString, parseArgs } from '../argv.js'
import { defaultAuthor } from '../identity.js'
import { injectDocIdAttr, readDocIdAttr } from '../docid.js'
import { chainPathFor } from './chain.js'
import { commitDocument, writeAtomic } from '../disk.js'

function summarizeReport(report: NormalizationReport): string {
  if (report.lines.length === 0) return 'no normalization changes'
  const counts = new Map<string, number>()
  for (const line of report.lines) counts.set(line.code, (counts.get(line.code) ?? 0) + 1)
  const parts = Array.from(counts.entries()).map(([code, n]) => (n > 1 ? `${code}×${n}` : code))
  return `${report.lines.length} normalization line(s): ${parts.join(', ')}`
}

export async function runIngest(args: string[], io: CliIO): Promise<number> {
  const { positionals, flags } = parseArgs(args)
  const file = positionals[0]
  if (!file) {
    io.stderr('usage: foundation ingest <file> [--commit [-m msg] [--author A]]')
    return 2
  }

  let source: string
  try {
    source = readFileSync(file, 'utf8')
  } catch (err) {
    io.stderr(`could not read ${file}: ${err instanceof Error ? err.message : String(err)}`)
    return 2
  }

  const { doc, report } = parseDocument(source)
  const canonical = projectDocument(doc)
  // SPEC 13a-i: the document id lives outside FdnDocument entirely (see
  // packages/cli/src/docid.ts) — parseDocument/projectDocument never see it,
  // so ingest must read it off the ORIGINAL source and re-stamp it onto the
  // freshly-projected text itself, or a plain `ingest` would silently strip
  // any existing data-fdn-doc-id (parse(project(doc)) is a fixpoint for
  // FdnDocument, but data-fdn-doc-id isn't part of FdnDocument at all).
  const docId = readDocIdAttr(source)
  const canonicalWithDocId = docId ? injectDocIdAttr(canonical, docId) : canonical

  if (report.lines.length === 0) {
    io.stdout(`${file}: no normalization needed`)
  } else {
    for (const line of report.lines) {
      const where = line.nodeId ? ` [${line.nodeId}]` : ''
      io.stdout(`${line.severity} ${line.code}${where}: ${line.message}`)
    }
  }

  const result = validateDocument(doc)
  const exitCode = result.valid ? 0 : 1
  const commitLines: string[] = []
  let commitFailure: string | null = null

  if (flags.commit) {
    const chainPath = chainPathFor(file)
    if (!existsSync(chainPath)) {
      commitLines.push(`${file}: --commit requested but no chain yet — run \`foundation chain init ${file}\` to start tracking changes`)
    } else {
      const author = flagString(flags, 'author') ?? defaultAuthor()
      const message = flagString(flags, 'm', 'message') ?? (report.lines.length === 0 ? 'ingest' : `ingest — ${summarizeReport(report)}`)
      try {
        const commit = commitDocument(chainPath, { author, message }, doc)
        commitLines.push(
          commit.status === 'committed'
            ? `${chainPath}: committed ${commit.envelope.hash.slice(0, 12)} (${message})`
            : `${chainPath}: no changes to commit (parsed document matches chain head)`,
        )
      } catch (err) {
        commitFailure = `chain commit failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  const changed = canonicalWithDocId !== source
  writeAtomic(file, canonicalWithDocId)
  io.stdout(`${file}: ${changed ? 'rewritten to canonical form' : 'already canonical, unchanged'}`)
  for (const line of commitLines) io.stdout(line)
  if (commitFailure) {
    io.stderr(commitFailure)
    return 2
  }

  return exitCode
}
