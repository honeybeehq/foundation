/** Deterministic report/ground-truth evaluation. No ground-truth input influences matching. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compare, readCapture } from "./index.ts";
import { csv, correspondenceMetrics, defectMetrics } from "./ground-truth.ts";
import { canonical } from "./canonical.ts";
const root = process.argv[2] ?? "packages/proof/fixtures/sample-captures";
const out = process.argv[3] ?? ".audit/round2";
await mkdir(out, { recursive: true });
const baseline = process.argv[4] === "-" ? undefined : process.argv[4];
const compareFn: typeof compare = baseline
  ? (await import(pathToFileURL(path.resolve(baseline)).href)).compare
  : compare;
const audit = (
  await readFile(
    "packages/proof/fixtures/sample-reports/visual-audit.tsv",
    "utf8",
  )
)
  .trim()
  .split("\n")
  .slice(1)
  .map((r) => r.split("\t"))
  .filter((r) => r[9] === "false-correspondence");
const rows = [];
for (const state of process.argv[5]?.split(",") ?? [
  "track-selected",
  "proposal-pending",
  "empty",
]) {
  const base = path.join(root, "tracks-pane", state, "1416x720@1");
  const [design, code] = await Promise.all([
    readCapture(path.join(base, "design")),
    readCapture(path.join(base, "code")),
  ]);
  const before = JSON.parse(
    await readFile(
      `packages/proof/fixtures/sample-reports/${state}/drift-report.json`,
      "utf8",
    ),
  );
  for (const ids of [true, false]) {
    const a = ids
      ? design
      : { ...design, nodes: design.nodes.map((n) => ({ ...n, fdnId: null })) };
    const b = ids
      ? code
      : { ...code, nodes: code.nodes.map((n) => ({ ...n, fdnId: null })) };
    const r = compareFn(a, b).report;
    const mapping = new Map(
      design.nodes.map((n) => [n.path, n.fdnId || n.path]),
    );
    const known = audit.filter((row) => row[0] === state);
    const badPairs = new Set(known.map((row) => `${row[4]}\t${row[5]}`));
    const remaining = r.matches.filter((m) =>
      badPairs.has(
        `${ids ? m.designNode : mapping.get(m.designNode)}\t${m.codeNode}`,
      ),
    );
    const name = `${state}-${ids ? "ids" : "no-ids"}`;
    await writeFile(path.join(out, name + ".json"), canonical(r) + "\n");
    const labels = `packages/proof/fixtures/ground-truth/${state}`;
    const correspondence = correspondenceMetrics(
      r,
      csv(await readFile(labels + ".correspondence.csv", "utf8")),
      a.nodes,
      b.nodes,
    );
    const candidates =
      r.defects ??
      r.drifts.map((d) => ({
        id: d.id,
        layer: {
          ...(d.designNode ? { design: d.designNode } : {}),
          ...(d.codeNode ? { code: d.codeNode } : {}),
        },
        kind: d.kind,
        cause: d.property,
        classification: "product" as const,
        findings: [d.id],
        summary: d.property,
      }));
    const defects = defectMetrics(
      candidates,
      r.drifts,
      csv(await readFile(labels + ".defects.csv", "utf8")),
      a.nodes,
      b.nodes,
    );
    await writeFile(
      path.join(out, name + "-metrics.json"),
      JSON.stringify({ correspondence, defects }, null, 2) + "\n",
    );
    rows.push({
      state,
      ids,
      phase: baseline ? "round1-raw-as-defects" : "round2",
      correspondencePrecision: correspondence.precision,
      correspondenceRecall: correspondence.recall,
      defectPrecision: defects.precision,
      defectRecall: defects.recall,
      agreedDefects: defects.tp,
      beforeRaw: before.drifts.length,
      ...(r.summary ?? {
        uniqueDefects: null,
        raw: r.drifts.length,
        uncertainMatches: 0,
      }),
      matches: r.matches.length,
      idMatches: r.matches.filter((m) => m.kind === "id").length,
      knownFalsePairs: badPairs.size,
      remainingKnownFalsePairs: remaining.length,
      remainingKnownFalseCertainPairs: remaining.filter((m) => !m.uncertain)
        .length,
      compareMs: r.timingsMs.compare,
    });
  }
}
await writeFile(
  path.join(out, "summary.json"),
  JSON.stringify(rows, null, 2) + "\n",
);
console.table(rows);
