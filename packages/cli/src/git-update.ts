import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { diffPatch, type FdnChain } from 'foundation-engine'
import { loadChain } from './chain-cache.js'
import { withWallTime } from './change-meta.js'
import { acquireDocumentLock } from './document-lock.js'
import { persistDocument, projectedText, recoverDocument, sourceBase, writeAtomic } from './disk.js'
import { parseForWrite } from './parse-write.js'
import type { CliIO } from './io.js'

function git(root: string, args: string[]): Buffer {
  return execFileSync('git', ['-C', root, ...args], { maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}
function paths(bytes: Buffer): string[] { return bytes.toString('utf8').split('\0').filter(Boolean) }
function editedChain(file: string): FdnChain {
  const chain = loadChain(readFileSync(`${file}.chain`), { actor: `git-update:${randomUUID()}` })
  const source = readFileSync(file, 'utf8')
  const parsed = parseForWrite(source)
  if (parsed.report.lines.some(line => line.severity === 'error')) throw new Error(`invalid local design: ${file}; ingest or repair it first`)
  const ops = diffPatch(sourceBase(chain, source, file), parsed.doc)
  if (ops === null) throw new Error(`local text edits cannot be preserved as changes: ${file}; ingest them first`)
  if (ops.length) chain.apply(withWallTime({ author: 'file', message: 'preserve local edits before Git update' }), ops)
  return chain
}
interface Entry { path: string; slot: string }
interface Journal { root: string; before: string; incoming: string; entries: Entry[] }

/** Keep the document locks for the ENTIRE Git operation: sync imports and
 * interactive writers use the same locks and retry after we restore edits. */
export function prepareGitUpdate(root: string, incoming: string, command: string[], io: CliIO): void {
  const target = git(root, ['rev-parse', '--verify', `${incoming}^{commit}`]).toString().trim()
  const before = git(root, ['rev-parse', 'HEAD']).toString().trim()
  git(root, ['merge-base', '--is-ancestor', before, target])
  if (git(root, ['diff', '--cached', '--name-only', '-z']).length) throw new Error('staged changes present; commit or unstage them before updating')
  const tracked = paths(git(root, ['ls-files', '-z']))
  const designs = tracked.filter(path => path.endsWith('.fdn.html.chain')).map(path => path.slice(0, -6)).sort()
  const allowed = new Set(designs.flatMap(path => [path, `${path}.chain`]))
  const releases: (() => void)[] = []
  let journalPath: string | undefined
  let journal: Journal | undefined
  let resetStarted = false
  try {
    for (const path of designs) releases.push(acquireDocumentLock(join(root, path)))
    for (const path of designs) recoverDocument(join(root, path))
    const dirty = paths(git(root, ['diff', 'HEAD', '--name-only', '-z']))
    const other = dirty.filter(path => !allowed.has(path))
    if (other.length) throw new Error(`non-design changes block the update: ${other.join(', ')}; commit or stash them yourself`)
    // Recheck after taking locks; a concurrent git index writer is unsupported.
    if (git(root, ['diff', '--cached', '--name-only', '-z']).length) throw new Error('the index changed while preparing the update')
    const changed = designs.filter(path => dirty.includes(path) || dirty.includes(`${path}.chain`))
    const prepared = changed.map(path => {
      const file = join(root, path), local = editedChain(file)
      const incomingBytes = git(root, ['show', `${target}:${path}.chain`])
      const next = loadChain(incomingBytes)
      if (!local.docId() || local.docId() !== next.docId()) throw new Error(`incoming design identity differs: ${path}`)
      const headBytes = git(root, ['show', `HEAD:${path}.chain`])
      if (loadChain(headBytes).docId() !== local.docId()) throw new Error(`local design identity differs from HEAD: ${path}`)
      // Preflight the merge before touching any file; preserve all local-only history.
      next.merge(local)
      return { path, local: local.save(), original: readFileSync(file), chain: readFileSync(`${file}.chain`), head: git(root, ['show', `HEAD:${path}`]), headBytes }
    })
    if (prepared.length) {
      const gitDir = git(root, ['rev-parse', '--absolute-git-dir']).toString().trim()
      journalPath = join(gitDir, 'foundation-updates', randomUUID())
      mkdirSync(journalPath, { recursive: true, mode: 0o700 })
      journal = { root, before, incoming: target, entries: prepared.map((entry, i) => ({ path: entry.path, slot: String(i) })) }
      for (const [i, entry] of prepared.entries()) {
        writeFileSync(join(journalPath, `${i}.html`), entry.original)
        writeFileSync(join(journalPath, `${i}.original.chain`), entry.chain)
        writeFileSync(join(journalPath, `${i}.chain`), entry.local)
      }
      writeFileSync(join(journalPath, 'journal.json'), JSON.stringify(journal))
      io.stderr(`Local design backup: ${journalPath}`)
      resetStarted = true
      for (const entry of prepared) {
        writeAtomic(join(root, `${entry.path}.chain`), entry.headBytes)
        writeAtomic(join(root, entry.path), entry.head)
      }
    }
    const [program, ...args] = command
    if (!program) throw new Error('prepare-update requires a command after --')
    const output = execFileSync(program, args, { cwd: root, maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
    if (output.length) io.stdout(output.toString().trimEnd())
    if (git(root, ['rev-parse', 'HEAD']).toString().trim() !== target) throw new Error('update command did not move HEAD to the requested incoming commit')
    if (journal && journalPath) restoreJournal(journal, journalPath, false)
    if (journalPath) rmSync(journalPath, { recursive: true })
    io.stdout('Git update complete; local design changes preserved')
  } catch (error) {
    if (resetStarted && journal && journalPath) {
      try {
        const unchangedHead = git(root, ['rev-parse', 'HEAD']).toString().trim() === before
        restoreJournal(journal, journalPath, unchangedHead)
      } catch (restoreError) { io.stderr(`Could not restore automatically: ${String(restoreError)}`) }
      io.stderr(`Backup retained; recover with foundation git recover-update ${JSON.stringify(journalPath)}`)
    }
    throw error
  } finally { for (const release of releases.reverse()) release() }
}

function restoreJournal(journal: Journal, dir: string, original: boolean): void {
  for (const entry of journal.entries) {
    const file = resolve(journal.root, entry.path)
    if (isAbsolute(entry.path) || relative(journal.root, file).startsWith('..')) throw new Error('invalid backup path')
    if (original) {
      writeAtomic(`${file}.chain`, readFileSync(join(dir, `${entry.slot}.original.chain`)))
      writeAtomic(file, readFileSync(join(dir, `${entry.slot}.html`)))
    } else {
      const local = loadChain(readFileSync(join(dir, `${entry.slot}.chain`)))
      const current = editedChain(file)
      if (local.docId() !== current.docId()) throw new Error(`cannot restore into different design: ${entry.path}`)
      const frontier = current.versionRef()
      current.merge(local)
      // Incoming bytes are already the desired result when local history is
      // contained: don't canonicalize/rewrite a freshly checked-out Git file.
      if (current.versionRef() !== frontier || readFileSync(file, 'utf8') !== projectedText(current)) persistDocument(file, current)
    }
  }
}

export function recoverGitUpdate(root: string, dir: string): void {
  const journal = JSON.parse(readFileSync(join(dir, 'journal.json'), 'utf8')) as Journal
  if (journal.root !== root) throw new Error('backup belongs to another repository')
  const releases: (() => void)[] = []
  try {
    for (const entry of journal.entries) releases.push(acquireDocumentLock(join(root, entry.path)))
    restoreJournal(journal, dir, false)
  } finally { for (const release of releases.reverse()) release() }
}

export function pullGit(root: string, args: string[], io: CliIO): void {
  if (args.length > 2 || args.some(arg => arg.startsWith('-'))) throw new Error('usage: foundation git pull [remote [branch]]')
  git(root, ['fetch', ...args])
  const ref = args.length ? 'FETCH_HEAD' : '@{upstream}'
  const target = git(root, ['rev-parse', '--verify', `${ref}^{commit}`]).toString().trim()
  prepareGitUpdate(root, target, ['git', 'merge', '--ff-only', target], io)
}
