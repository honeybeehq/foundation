/**
 * `foundation chain ...` — CLI surface over `<file>.chain` (Loro-backed
 * FdnChain, engine/src/chain). Two argument shapes coexist by design:
 *
 *   - `chain <file> log|verify`         (original v0 shape, kept as-is —
 *     API.md CLI section) — file first, subcommand second.
 *   - `chain init|anchor|diff <file> ...` (new, wave "wire the chain into
 *     the authoring loop") — subcommand first, file second, matching the
 *     brief's literal usage strings and reading naturally as git-style verbs.
 *
 * `chainPathFor`/`writeChainInit` are exported so `new.ts` can init a chain
 * for a freshly-skeletoned document without re-deriving the `<file>.chain`
 * naming convention or the create+save dance.
 */
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createChain, exportBlobs, importBlobs, loadChain, mergeChains, parseDocument, projectDocument } from 'foundation-engine'
import type { ChangeMeta, EnvelopeRecord, FdnChain, FdnDocument, OverlapReport, SemanticOp } from 'foundation-engine'
import type { CliIO } from '../io.js'
import { flagString, parseArgs } from '../argv.js'
import { injectDocIdAttr, readDocIdAttr } from '../docid.js'
import { withDocumentLock } from '../document-lock.js'
import { withWallTime } from '../change-meta.js'
import { defaultAuthor } from '../identity.js'
import { persistDocument, updateDocument, writeAtomic } from '../disk.js'

export function chainPathFor(file: string): string {
  return `${file}.chain`
}

/** Shared by `chain init` and `new` (auto-init on document birth). Prints its
 *  own error and returns null when `<file>.chain` already exists — callers
 *  decide whether that's fatal (chain init: yes) or a soft warning (new:
 *  no, the document itself was still written successfully). `opts.docId`
 *  (SPEC 13a-i) is folded into the chain's own single init commit — see
 *  chain.ts's Wave 3 contract-amendment note. */
export function writeChainInit(
  file: string,
  doc: FdnDocument,
  meta: ChangeMeta,
  io: CliIO,
  opts?: { docId?: string; newDocument?: boolean },
): { chainPath: string; head: EnvelopeRecord } | null {
  return withDocumentLock(file, () => {
    const chainPath = chainPathFor(file)
    if (opts?.newDocument && existsSync(file)) {
      io.stderr(`refusing to create: ${file} already exists`)
      return null
    }
    if (existsSync(chainPath)) {
      io.stderr(`refusing to init: ${chainPath} already exists`)
      return null
    }
    const chain = createChain(doc, withWallTime(meta), opts?.docId ? { docId: opts.docId } : undefined)
    persistDocument(file, chain, undefined, false)
    return { chainPath, head: chain.head() }
  })
}

function printOverlaps(overlaps: OverlapReport, io: CliIO): void {
  if (overlaps.lines.length === 0) {
    io.stdout('  no concurrent-overlap conflicts')
    return
  }
  for (const line of overlaps.lines) io.stdout(`  concurrent-overlap: ${line.message}`)
}

function loadChainFor(chainPath: string): FdnChain {
  return loadChain(readFileSync(chainPath))
}

function formatSemanticOp(op: SemanticOp): string {
  switch (op.op) {
    case 'insert-node':
      return `insert-node ${op.id} tag=${op.tag} parent=${op.parent ?? '(root)'} index=${op.index}`
    case 'remove-node':
      return `remove-node ${op.id}`
    case 'move-node':
      return `move-node ${op.id} parent=${op.parent ?? '(root)'} index=${op.index}`
    case 'set-attr':
      return `set-attr ${op.id} ${op.key}=${op.value === null ? '(removed)' : JSON.stringify(op.value)}`
    case 'set-style':
      return `set-style ${op.id}${op.state ? `:${op.state}` : ''} ${op.prop}=${op.value === null ? '(removed)' : JSON.stringify(op.value)}`
    case 'set-text':
      return `set-text ${op.id} text=${JSON.stringify(op.text)}`
    case 'set-style-ref':
      return `set-style-ref ${op.id} styleRef=${op.styleRef === null ? '(removed)' : JSON.stringify(op.styleRef)}`
    case 'set-when':
      return `set-when ${op.id} when=${op.when === null ? '(removed)' : JSON.stringify(op.when)}`
    case 'section-changed':
      return `section-changed ${op.section}.${op.name}`
  }
}

async function runChainInitCommand(positionals: string[], flags: Record<string, string | boolean>, io: CliIO): Promise<number> {
  const file = positionals[0]
  if (!file) {
    io.stderr('usage: foundation chain init <file> [--author A] [-m msg]')
    return 2
  }

  let source: string
  try {
    source = readFileSync(file, 'utf8')
  } catch (err) {
    io.stderr(`could not read ${file}: ${err instanceof Error ? err.message : String(err)}`)
    return 2
  }

  // SPEC 13a-i: reuse the doc id already stamped in the text (e.g. by
  // `foundation new`) if present, else mint one now and stamp it in —
  // `chain init` is the OTHER place (besides `new`) that guarantees every
  // chain-tracked document has one from here on.
  const stampedDocId = readDocIdAttr(source)
  const docId = stampedDocId ?? randomUUID()

  const { doc, report: sourceReport } = parseDocument(source)
  const malformedSet = sourceReport.lines.find((line) => ['malformed-component-set', 'malformed-instance-overrides', 'misplaced-override-wrapper'].includes(line.code))
  if (malformedSet) { io.stderr(malformedSet.message); return 1 }
  const author = flagString(flags, 'author') ?? defaultAuthor()
  const message = flagString(flags, 'm', 'message') ?? 'init'

  const result = writeChainInit(file, doc, { author, message }, io, { docId })
  if (!result) return 2

  io.stdout(`wrote ${result.chainPath} (head ${result.head.hash.slice(0, 12)})`)
  return 0
}

async function runChainAnchor(positionals: string[], io: CliIO): Promise<number> {
  const [file, name] = positionals
  if (!file || !name) {
    io.stderr('usage: foundation chain anchor <file> <name>')
    return 2
  }

  const chainPath = chainPathFor(file)
  if (!existsSync(chainPath)) {
    io.stdout(`${file}: no chain yet (${chainPath} not found) — run \`foundation chain init ${file}\` first`)
    return 0
  }

  try {
    updateDocument(file, chain => {
      chain.anchor(name, withWallTime({ author: defaultAuthor(), message: `Anchor ${name}` }))
      io.stdout(`${chainPath}: anchored '${name}' at ${chain.head().hash.slice(0, 12)}`)
    })
  } catch (err) {
    io.stderr(`could not anchor ${file}: ${err instanceof Error ? err.message : String(err)}`)
    return 2
  }
  return 0
}

async function runChainDiff(positionals: string[], io: CliIO): Promise<number> {
  const [file, anchorA, anchorB] = positionals
  if (!file || !anchorA || !anchorB) {
    io.stderr('usage: foundation chain diff <file> <anchorA> <anchorB>')
    return 2
  }

  const chainPath = chainPathFor(file)
  if (!existsSync(chainPath)) {
    io.stdout(`${file}: no chain yet (${chainPath} not found) — run \`foundation chain init ${file}\` first`)
    return 0
  }

  let chain: FdnChain
  try {
    chain = loadChainFor(chainPath)
  } catch (err) {
    io.stderr(`could not read ${chainPath}: ${err instanceof Error ? err.message : String(err)}`)
    return 2
  }

  let ops: SemanticOp[]
  try {
    ops = chain.diff(anchorA, anchorB)
  } catch (err) {
    io.stderr(`chain diff: ${err instanceof Error ? err.message : String(err)}`)
    return 2
  }

  if (ops.length === 0) {
    io.stdout(`${chainPath}: no differences between '${anchorA}' and '${anchorB}'`)
    return 0
  }

  io.stdout(`${chainPath}: ${anchorA}..${anchorB} (${ops.length} op(s))`)
  for (const op of ops) io.stdout(`  ${formatSemanticOp(op)}`)
  return 0
}

async function runChainLogVerify(file: string, subcommand: string, io: CliIO, flags: Record<string, string | boolean>): Promise<number> {
  const chainPath = chainPathFor(file)
  if (!existsSync(chainPath)) {
    if (subcommand === 'log' && flags.json) {
      io.stdout(JSON.stringify({ entries: [], nextCursor: null, latestCursor: null, hasMore: false }))
      return 0
    }
    io.stdout(`${file}: no chain yet (${chainPath} not found) — this document is plain text so far`)
    return 0
  }

  let bytes: Uint8Array
  try {
    bytes = readFileSync(chainPath)
  } catch (err) {
    io.stderr(`could not read ${chainPath}: ${err instanceof Error ? err.message : String(err)}`)
    return 2
  }

  const chain = loadChain(bytes)

  if (subcommand === 'log') {
    if (flags.json) {
      try {
        for (const flag of ['limit', 'before']) {
          if (flags[flag] === true) throw new Error(`--${flag} requires a value`)
        }
        const limit = flagString(flags, 'limit')
        io.stdout(JSON.stringify(chain.logPage({
          ...(limit !== undefined ? { limit: Number(limit) } : {}),
          before: flagString(flags, 'before'),
        })))
        return 0
      } catch (err) {
        io.stderr(err instanceof Error ? err.message : String(err))
        return 2
      }
    }
    const entries = chain.log()
    if (entries.length === 0) {
      io.stdout(`${chainPath}: empty chain`)
      return 0
    }
    // oldest first, newest last (log() already returns changes in that order).
    for (const entry of entries) {
      io.stdout(`${entry.hash.slice(0, 12)}  ${entry.author}${entry.originNode ? `  @${entry.originNode}` : ''}  ${entry.message}`)
    }
    return 0
  }

  // subcommand === 'verify'
  const result = chain.verify()
  if (result.ok) {
    io.stdout(`${chainPath}: envelope hash chain OK`)
    return 0
  }
  io.stdout(`${chainPath}: envelope hash chain BROKEN${result.brokenAt ? ` at ${result.brokenAt}` : ''}`)
  return 1
}

// ——— Wave 3: blob-directory exchange (SPEC 13a-iv, API.md "chain exchange") ———

function requireChain(file: string, io: CliIO): FdnChain | null {
  const chainPath = chainPathFor(file)
  if (!existsSync(chainPath)) {
    io.stdout(`${file}: no chain yet (${chainPath} not found) — run \`foundation chain init ${file}\` first`)
    return null
  }
  return loadChainFor(chainPath)
}

/** True when `file`'s current text doesn't canonically match the chain's
 *  current head doc — i.e. there's an edit sitting in the text that hasn't
 *  been `ingest --commit`ed onto the chain yet. Checked BEFORE importing
 *  (gate finding, Wave 3 follow-up): pulling in foreign changes and then
 *  regenerating the text from the merged chain would silently clobber that
 *  uncommitted edit, so pull/sync must detect it first and skip
 *  regeneration rather than guess. Same "did the file already match the
 *  chain" comparison ingest.ts's own `--commit` no-op check makes. */
export function hasUncommittedEdits(file: string, chain: FdnChain): boolean {
  const source = readFileSync(file, 'utf8')
  const { doc } = parseDocument(source)
  return projectDocument(doc) !== projectDocument(chain.doc())
}

/** Regenerates `file` from `chain`'s current (post-import) doc and re-stamps
 *  the doc id — the fix for the "truth converged, view stale" gate finding:
 *  importing blobs alone only updates `<file>.chain`, never the projected
 *  `.fdn.html` text, so a peer who only ever looks at the text would keep
 *  seeing their own edit forever even after a successful pull. */
export function regenerateTextFromChain(file: string, chain: FdnChain, io: CliIO): void {
  updateDocument(file, latest => { latest.merge(chain) })
  io.stdout(`updated ${file} from merged chain`)
}

async function runChainPush(positionals: string[], io: CliIO): Promise<number> {
  const [file, dir] = positionals
  if (!file || !dir) {
    io.stderr('usage: foundation chain push <file> <dir>')
    return 2
  }
  const chain = requireChain(file, io)
  if (!chain) return 0
  try {
    const { written } = await exportBlobs(chain, dir)
    io.stdout(`${chainPathFor(file)}: pushed ${written} blob(s) to ${dir}/${chain.docId()}`)
    return 0
  } catch (err) {
    io.stderr(`chain push: ${err instanceof Error ? err.message : String(err)}`)
    return 2
  }
}

async function runChainPull(positionals: string[], io: CliIO): Promise<number> {
  const [file, dir] = positionals
  if (!file || !dir) {
    io.stderr('usage: foundation chain pull <file> <dir>')
    return 2
  }
  const chain = requireChain(file, io)
  if (!chain) return 0
  try {
    const { imported, overlaps } = await importBlobs(chain, dir)
    if (imported > 0) updateDocument(file, latest => { latest.merge(chain) })
    io.stdout(`${chainPathFor(file)}: pulled ${imported} blob(s) from ${dir}/${chain.docId()}`)
    printOverlaps(overlaps, io)
    if (imported > 0) io.stdout(`updated ${file} from merged chain`)
    return 0
  } catch (err) {
    io.stderr(`chain pull: ${err instanceof Error ? err.message : String(err)}`)
    return 2
  }
}

async function runChainSync(positionals: string[], io: CliIO): Promise<number> {
  const [file, dir] = positionals
  if (!file || !dir) {
    io.stderr('usage: foundation chain sync <file> <dir>')
    return 2
  }
  let chain = requireChain(file, io)
  if (!chain) return 0
  try {
    const { imported, overlaps } = await importBlobs(chain, dir)
    const importedChain = chain
    chain = updateDocument(file, latest => { latest.merge(importedChain); return latest })
    const { written } = await exportBlobs(chain, dir)
    io.stdout(`${chainPathFor(file)}: synced with ${dir}/${chain.docId()} — pulled ${imported}, pushed ${written}`)
    printOverlaps(overlaps, io)
    if (imported > 0) io.stdout(`updated ${file} from merged chain`)
    return 0
  } catch (err) {
    io.stderr(`chain sync: ${err instanceof Error ? err.message : String(err)}`)
    return 2
  }
}

/** `chain merge <file> <theirs.chain>` — mergeChains() + regenerate the
 *  .fdn.html text from the merged doc (projectDocument), per the task
 *  brief. `<file>.chain` is overwritten with the merged snapshot; `<file>`
 *  itself is overwritten with the merged, re-stamped canonical text. */
async function runChainMerge(positionals: string[], io: CliIO): Promise<number> {
  const [file, theirsPath] = positionals
  if (!file || !theirsPath) {
    io.stderr('usage: foundation chain merge <file> <theirs.chain>')
    return 2
  }
  const chainPath = chainPathFor(file)
  if (!existsSync(chainPath)) {
    io.stdout(`${file}: no chain yet (${chainPath} not found) — run \`foundation chain init ${file}\` first`)
    return 0
  }
  if (!existsSync(theirsPath)) {
    io.stderr(`could not read ${theirsPath}: no such file`)
    return 2
  }

  let ours: Uint8Array
  let theirs: Uint8Array
  try {
    ours = readFileSync(chainPath)
    theirs = readFileSync(theirsPath)
  } catch (err) {
    io.stderr(`chain merge: ${err instanceof Error ? err.message : String(err)}`)
    return 2
  }

  const { overlaps } = mergeChains(ours, theirs)
  const mergedChain = loadChain(theirs)
  updateDocument(file, chain => { chain.merge(mergedChain) })
  io.stdout(`${chainPath}: merged with ${theirsPath} — rewrote ${file}`)
  printOverlaps(overlaps, io)
  return 0
}

async function runChainRecover(positionals: string[], io: CliIO): Promise<number> {
  const [file] = positionals
  if (!file) { io.stderr('usage: foundation chain recover <file>'); return 2 }
  try {
    withDocumentLock(file, () => {
      const chain = loadChain(readFileSync(chainPathFor(file)))
      const suffix = randomUUID()
      for (const source of [file, `${file}.chain.pending`]) {
        if (!existsSync(source)) continue
        const backup = `${source}.unapplied-${suffix}`
        writeAtomic(backup, readFileSync(source))
        io.stdout(`backed up ${source} to ${backup}`)
      }
      persistDocument(file, chain)
      io.stdout(`restored ${file} from the current chain; reapply unapplied edits from the backups`)
    })
    return 0
  } catch (err) {
    io.stderr(err instanceof Error ? err.message : String(err))
    return 2
  }
}

export async function runChain(args: string[], io: CliIO): Promise<number> {
  const { positionals, flags } = parseArgs(args)
  const [first] = positionals

  if (first === 'init') return runChainInitCommand(positionals.slice(1), flags, io)
  if (first === 'anchor') return runChainAnchor(positionals.slice(1), io)
  if (first === 'recover') return runChainRecover(positionals.slice(1), io)
  if (first === 'diff') return runChainDiff(positionals.slice(1), io)
  if (first === 'push') return runChainPush(positionals.slice(1), io)
  if (first === 'pull') return runChainPull(positionals.slice(1), io)
  if (first === 'sync') return runChainSync(positionals.slice(1), io)
  if (first === 'merge') return runChainMerge(positionals.slice(1), io)

  // original shape: chain <file> log|verify
  const [file, subcommand] = positionals
  if (!file || !subcommand) {
    io.stderr('usage: foundation chain <file> log|verify (or: chain init|anchor|diff ...)')
    return 2
  }
  if (subcommand !== 'log' && subcommand !== 'verify') {
    io.stderr(`usage: foundation chain <file> log|verify (got "${subcommand}")`)
    return 2
  }
  return runChainLogVerify(file, subcommand, io, flags)
}
