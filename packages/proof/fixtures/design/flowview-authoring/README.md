# Flow View authoring inputs (U1)

`tracks-pane-flowview.fdn.html` is Tormod's `tracks-pane.fdn.html` plus seven chain commits
(author `agent:claude-u1`) that bring the board up to date with Classic TracksPane's Flow View.
The original file is untouched; the new file continues its chain, so the history reads
Tormod's edits first, then the Flow View change set, and can replace the original as a
fast-forward once approved.

How the commits were made, so the change set can be rebuilt or extended:

1. `assemble.py` writes a draft document from the original plus `components.html`,
   `styles.html`, `main.html` and `pane.py` (values measured from the code capture DOM and
   Apiary `packages/ui/src/tokens.stylex.ts`).
2. `plan-ops.ts` asks the engine (`diffPatch`) for the semantic ops from the chain head to
   the draft and splits them into themed batches.
3. Each batch was committed with `foundation edit <file> --ops-file <batch>.json --label …`,
   which goes through the session protocol and appends one chain change per batch.

```sh
python3 -I assemble.py ../tracks-pane.fdn.html /tmp/draft.fdn.html
pnpm exec tsx plan-ops.ts ../tracks-pane-flowview.fdn.html /tmp/draft.fdn.html /tmp/ops   # 0 ops = head equals draft
```
