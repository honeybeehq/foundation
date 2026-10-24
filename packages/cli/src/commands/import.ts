import { mintNodeId } from 'foundation-engine'
import { parseForWrite } from '../parse-write.js'
/**
 * `foundation import <source.tsx> --into <file.fdn.html> [--name N]
 * [--props <json>] [--sealed]` — Wave 4 Stage 3 CLI wiring over
 * packages/importer (API.md "Wave 4 — component importer" CLI section):
 * harvest (Stage 1) -> project (Stage 2, forceSealed for --sealed) -> merge
 * the resulting FdnComponent into the target document (add/replace by name)
 * -> write via the ORDINARY canonicalize path (parse/project, same as
 * `ingest`) -> chain-commit when a chain exists next to the target file.
 *
 * The importer package pulls in esbuild + react/react-dom + tailwindcss —
 * real weight, nothing else this CLI touches comes close — so it is loaded
 * lazily via a computed import specifier (same trick commands/render.ts and
 * mcp/tools.ts already use for the Wave 2 render/diff modules): every other
 * `foundation` invocation, and in particular `foundation mcp`'s stdio
 * server startup, must not pay that cost just because `import` exists as a
 * command somewhere in the binary.
 *
 * Imported node identities are fresh UUIDs. Reimport preserves existing ids
 * for unchanged subtrees, so unchanged imports remain a no-op.
 */
import { existsSync, readFileSync } from 'node:fs'
import { loadChain, parseDocument, projectDocument } from 'foundation-engine'
import type { FdnComponent, FdnDocument, FdnLookup, FdnNode, FdnProp } from 'foundation-engine'
import type { CliIO } from '../io.js'
import { flagString, parseArgs } from '../argv.js'
import { defaultAuthor } from '../identity.js'
import { injectDocIdAttr, readDocIdAttr } from '../docid.js'
import { chainPathFor } from './chain.js'
import { commitDocument, sourceBase, writeUntrackedDocument } from '../disk.js'

// ——— lazy foundation-importer loader (computed specifier — see module doc) ———

// Exported (not just used locally) so mcp/tools.ts's foundation_import can
// share this exact loader/merge/renumber logic instead of re-deriving it —
// same sharing pattern as chainPathFor/writeChainInit (commands/chain.js)
// and skeletonDocument (commands/new.js), which mcp/tools.ts already reaches
// into rather than duplicating.
export interface HarvestComponentOptions {
  source: string
  name?: string
  props?: FdnProp[]
}
export interface RenderArtifact {
  name: string
  propSchema: FdnProp[]
  provenance: { source: string; contentSha256: string }
}
export interface ProjectResult {
  component: FdnComponent
  mode: 'native' | 'sealed'
  report: { code: string; severity: string; message: string; nodeId?: string; detail?: unknown }[]
  extraLookups: FdnLookup[]
  extraTokens: Record<string, string>
}
interface HarnessErrorLike extends Error {
  code: string
  detail?: unknown
}
export interface ImporterModule {
  harvestComponent: (opts: HarvestComponentOptions) => Promise<RenderArtifact>
  projectArtifact: (artifact: RenderArtifact, opts?: { forceSealed?: boolean }) => ProjectResult
}

// Not an inline string literal in the import() call on purpose: TypeScript
// would otherwise statically resolve+typecheck the target module's own
// exports against this call site, re-coupling the CLI to foundation-importer
// at compile time even though the whole point is to defer loading it (and
// everything it drags in) to the one command/tool that actually needs it.
const IMPORTER_MODULE_SPEC = 'foundation-importer'

export async function loadImporterModule(): Promise<ImporterModule> {
  return (await import(IMPORTER_MODULE_SPEC)) as unknown as ImporterModule
}

function isHarnessErrorLike(err: unknown): err is HarnessErrorLike {
  return err instanceof Error && typeof (err as { code?: unknown }).code === 'string'
}

export function formatStructuredError(stage: 'harvest' | 'project', err: unknown): string {
  if (isHarnessErrorLike(err)) {
    const detail = err.detail !== undefined ? ` ${JSON.stringify(err.detail)}` : ''
    return `${stage} failed [${err.code}]: ${err.message}${detail}`
  }
  return `${stage} failed: ${err instanceof Error ? err.message : String(err)}`
}

export function harnessErrorCode(err: unknown): string | undefined {
  return isHarnessErrorLike(err) ? err.code : undefined
}

// ——— replica-safe imported identities ———

/** Match unchanged subtrees by content, so insertion/reordering never shifts identities. */
export function remintComponentIds(nodes: FdnNode[], existing: FdnNode[] = []): FdnNode[] {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, stable(value)])) : value
  const shape = (node: FdnNode): unknown => ({ ...node, id: undefined, children: node.children.map(shape) })
  const key = (node: FdnNode): string => JSON.stringify(stable(shape(node)))
  const candidates = new Map<string, string[]>()
  const collect = (nodes: FdnNode[]): void => { for (const node of nodes) { const k = key(node); candidates.set(k, [...(candidates.get(k) ?? []), node.id]); collect(node.children) } }
  collect(existing)
  const remint = (node: FdnNode): FdnNode => ({ ...node, id: candidates.get(key(node))?.shift() ?? mintNodeId(), children: node.children.map(remint) })
  return nodes.map(remint)
}

/** The pure importer may use local names; the live writer assigns shared identities. */
export function prepareImportedComponent(doc: FdnDocument, projected: ProjectResult): { component: FdnComponent; extraLookups: FdnLookup[] } {
  const existing = doc.components.find(item => item.name === projected.component.name)
  const references = JSON.stringify(existing ?? {})
  const names = new Map<string, string>()
  const extraLookups = projected.extraLookups.map(lookup => {
    const previous = doc.lookups.find(item => references.includes(`${item.name}[`) && JSON.stringify(item.entries) === JSON.stringify(lookup.entries))
    const name = previous?.name ?? `lookup_${mintNodeId().slice(2).replaceAll('-', '_')}`
    names.set(lookup.name, name)
    return { ...lookup, name }
  })
  const body = projected.component.body
  // Rewrite only the exact lookup expression shape emitted by foldValues.
  // Quoted strings, property refs and each aliases are outside this pattern.
  const renamed = JSON.parse(JSON.stringify(body, (_key, value: unknown) => typeof value === 'string'
    ? value.replace(/{{([\s\S]*?)}}/g, (span, expression: string) => {
      const lookup = /^\s*([A-Za-z_][\w-]*)(\[prop\.[A-Za-z_][\w-]*\])\s*$/.exec(expression)
      if (lookup && names.has(lookup[1]!)) return `{{ ${names.get(lookup[1]!)}${lookup[2]} }}`
      const unquoted = expression.replace(/'(?:[^'\\]|\\.)*(?:'|$)|"(?:[^"\\]|\\.)*(?:"|$)/g, '')
      for (const ref of unquoted.matchAll(/(?<![\w.-])([A-Za-z_][\w-]*)\s*\[/g)) {
        if (names.has(ref[1]!)) throw new Error(`unsupported generated lookup expression: ${expression}`)
      }
      return span
    })
    : value)) as FdnNode[]
  const component = { ...projected.component, body: remintComponentIds(renamed, existing?.body) }
  return { component, extraLookups }
}

// ——— lookup merge (name-collision -> error with hint) ———

export function mergeLookups(existing: FdnLookup[], extra: FdnLookup[]): { lookups: FdnLookup[] } | { error: string } {
  const merged = [...existing]
  const indexByName = new Map(merged.map((l, i) => [l.name, i]))
  for (const lk of extra) {
    const idx = indexByName.get(lk.name)
    if (idx === undefined) {
      indexByName.set(lk.name, merged.length)
      merged.push(lk)
      continue
    }
    const cur = merged[idx] as FdnLookup
    if (JSON.stringify(cur.entries) !== JSON.stringify(lk.entries)) {
      return {
        error:
          `lookup name collision: "${lk.name}" is already declared in doc.lookups with different entries ` +
          `(existing: ${JSON.stringify(cur.entries)}, new: ${JSON.stringify(lk.entries)}) — the importer names ` +
          `generated lookups "<Component>Lookup<N>", so this is almost always two different components ` +
          `(or two imports of the same component under different --name overrides) colliding on the same ` +
          `generated name; re-run with a different --name, or edit/remove the existing "${lk.name}" lookup ` +
          `in the target document before re-importing.`,
      }
    }
    // identical name + identical entries: already merged (e.g. a repeated,
    // idempotent import of the same component) — nothing to do.
  }
  return { lookups: merged }
}

// ——— token merge (follow-up wave: "Tailwind theme vars become Foundation
//      tokens on import" — document wins on conflict, unlike mergeLookups
//      above) ———

export interface ReportLineLike {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  detail?: unknown
}

/** Merges `extra` (an import's `projected.extraTokens`, i.e. resolved
 *  Tailwind theme vars keyed like `doc.tokens`) into `existing` (the target
 *  document's current `doc.tokens`). Unlike `mergeLookups`, a collision here
 *  is NEVER an error: a document's own token layer is its design system —
 *  deliberately hand-authored, deliberately meaningful (`--color-accent` is
 *  not an accident) — so when an imported var and an existing token share a
 *  name but disagree on value, the DOCUMENT wins and the import's value is
 *  dropped, reported as a warning (`import-token-conflict`) rather than
 *  silently overwriting a design decision the document's author made on
 *  purpose. Same name + same value, or the name simply not present yet:
 *  set it, no report needed (that's the whole point — a var the document
 *  never mentioned is exactly what should flow in silently). */
export function mergeTokens(existing: Record<string, string>, extra: Record<string, string>): { tokens: Record<string, string>; conflicts: ReportLineLike[] } {
  const tokens = { ...existing }
  const conflicts: ReportLineLike[] = []
  for (const [name, value] of Object.entries(extra)) {
    const cur = tokens[name]
    if (cur === undefined) {
      tokens[name] = value
      continue
    }
    if (cur === value) continue
    conflicts.push({
      code: 'import-token-conflict',
      severity: 'warning',
      message:
        `token --${name} already has a different value in this document ("${cur}") than the imported definition ` +
        `("${value}") — keeping the document's value (the document's design system wins over an import).`,
      detail: { name, documentValue: cur, importedValue: value },
    })
    // document wins: no assignment.
  }
  return { tokens, conflicts }
}

const USAGE = 'usage: foundation import <source.tsx> --into <file.fdn.html> [--name N] [--props <json>] [--sealed] [--author A]'

export async function runImport(args: string[], io: CliIO): Promise<number> {
  const { positionals, flags } = parseArgs(args)
  const source = positionals[0]
  const into = flagString(flags, 'into')
  if (!source || !into) {
    io.stderr(USAGE)
    return 2
  }

  const name = flagString(flags, 'name')
  const sealed = flags.sealed === true
  const propsJson = flagString(flags, 'props')

  let propsOverride: FdnProp[] | undefined
  if (propsJson !== undefined) {
    try {
      const parsed: unknown = JSON.parse(propsJson)
      if (!Array.isArray(parsed)) throw new Error('expected a JSON array of prop overrides')
      propsOverride = parsed as FdnProp[]
    } catch (err) {
      io.stderr(`foundation import: --props must be a JSON array of FdnProp objects: ${err instanceof Error ? err.message : String(err)}`)
      return 2
    }
  }

  let targetSource: string
  try {
    targetSource = readFileSync(into, 'utf8')
  } catch (err) {
    io.stderr(`could not read ${into}: ${err instanceof Error ? err.message : String(err)}`)
    return 2
  }

  const editBase = existsSync(chainPathFor(into)) ? sourceBase(loadChain(readFileSync(chainPathFor(into))), targetSource, into) : parseDocument(targetSource).doc
  const importer = await loadImporterModule()

  let artifact: RenderArtifact
  try {
    artifact = await importer.harvestComponent({
      source,
      ...(name !== undefined ? { name } : {}),
      ...(propsOverride !== undefined ? { props: propsOverride } : {}),
    })
  } catch (err) {
    io.stderr(`foundation import: ${formatStructuredError('harvest', err)}`)
    return 1
  }

  let projected: ProjectResult
  try {
    projected = importer.projectArtifact(artifact, sealed ? { forceSealed: true } : undefined)
  } catch (err) {
    io.stderr(`foundation import: ${formatStructuredError('project', err)}`)
    return 1
  }

  const { doc, report: sourceReport } = parseForWrite(targetSource)
  const malformedSet = sourceReport.lines.find((line) => ['malformed-component-set', 'malformed-instance-overrides', 'misplaced-override-wrapper'].includes(line.code))
  if (malformedSet) { io.stderr(malformedSet.message); return 1 }

  const targetName = projected.component.name
  const existingIndex = doc.components.findIndex((c) => c.name === targetName)
  const { component, extraLookups } = prepareImportedComponent(doc, projected)

  const lookupResult = mergeLookups(doc.lookups, extraLookups)
  if ('error' in lookupResult) {
    io.stderr(`foundation import: ${lookupResult.error}`)
    return 1
  }

  const tokenResult = mergeTokens(doc.tokens, projected.extraTokens)

  const components =
    existingIndex === -1 ? [...doc.components, component] : doc.components.map((c, i) => (i === existingIndex ? component : c))

  const nextDoc: FdnDocument = { ...doc, components, lookups: lookupResult.lookups, tokens: tokenResult.tokens }

  // ordinary canonicalize path (API.md: "via ordinary ingest+commit" — same
  // project -> re-stamp-doc-id -> write dance as `ingest`, see ingest.ts).
  const canonical = projectDocument(nextDoc)
  const docId = readDocIdAttr(targetSource)
  const canonicalWithDocId = docId ? injectDocIdAttr(canonical, docId) : canonical

  const chainPath = chainPathFor(into)
  let commitLine: string | null = null
  let commitFailure: string | null = null
  if (existsSync(chainPath)) {
    const author = flagString(flags, 'author') ?? defaultAuthor()
    const message = `import ${component.name} from ${source} (${projected.mode})`
    try {
      const commit = commitDocument(chainPath, { author, message }, nextDoc, editBase, targetSource)
      commitLine =
        commit.status === 'committed'
          ? `${chainPath}: committed ${commit.envelope.hash.slice(0, 12)} (${message})`
          : `${chainPath}: no changes to commit (parsed document matches chain head)`
    } catch (err) {
      commitFailure = `chain commit failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  if (!existsSync(chainPath)) writeUntrackedDocument(into, canonicalWithDocId)

  for (const line of [...projected.report, ...tokenResult.conflicts]) {
    io.stdout(`${line.severity} ${line.code}: ${line.message}`)
  }
  io.stdout(`mode: ${projected.mode}`)
  io.stdout(`provenance: source=${artifact.provenance.source} sha256=${artifact.provenance.contentSha256}`)
  io.stdout(`${into}: ${existingIndex === -1 ? 'added' : 'replaced'} component "${component.name}" (${projected.mode})`)
  if (commitLine) io.stdout(commitLine)
  if (commitFailure) {
    io.stderr(commitFailure)
    return 2
  }

  return 0
}
