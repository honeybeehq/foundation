// Diff the chain head against the Flow View draft and split the semantic ops
// into themed batches for `foundation edit`. Usage: tsx plan-ops.ts HEAD.fdn.html DRAFT.fdn.html OUTDIR
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { parseDocument, diffPatch } from '../../../../engine/src/index.ts'
const [head, draft, out] = process.argv.slice(2)
const from = parseDocument(readFileSync(head, 'utf8')).doc
const to = parseDocument(readFileSync(draft, 'utf8')).doc
const ops = diffPatch(from, to)
if (!ops) throw new Error('diffPatch refused')
const kept = new Set(from.components.map(c => c.name))
const batches: Record<string, any[]> = { tokens: [], styles: [], newComponents: [], changedComponents: [], model: [], boards: [], removals: [], other: [] }
for (const op of ops as any[]) {
  if (op.op === 'set-token') batches.tokens.push(op)
  else if (op.op === 'set-named-style' || op.op === 'remove-named-style') (op.op === 'remove-named-style' ? batches.removals : batches.styles).push(op)
  else if (op.op === 'set-component') (kept.has(op.component.name) ? batches.changedComponents : batches.newComponents).push(op)
  else if (op.op === 'remove-component' || op.op === 'remove-data' || op.op === 'remove-lookup' || op.op === 'remove-param') batches.removals.push(op)
  else if (/^(set-param|set-data|set-lookup|set-lookup-entry|set-state|set-title|set-declaration-order)$/.test(op.op)) batches.model.push(op)
  else if (/node|set-attr|set-style|set-text|set-when/.test(op.op)) batches.boards.push(op)
  else batches.other.push(op)
}
mkdirSync(out, { recursive: true })
for (const [k, v] of Object.entries(batches)) { writeFileSync(`${out}/${k}.json`, JSON.stringify(v)); console.log(k, v.length, [...new Set(v.map((o: any) => o.op))].join(',')) }
