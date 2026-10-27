/** Preserve the author's visual correspondence review without modifying raw reports. */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const out = "packages/proof/fixtures/sample-reports";
const falsePairs: Record<string, [string, string, string][]> = {
  "track-selected": [
    [
      "n212::n141::n1",
      "0/0/0/2/0/0",
      "Different controls: design ellipsis menu versus code sidecar hexagon",
    ],
    [
      "n212::n142",
      "0",
      "Design inner body incorrectly paired to the entire capture root",
    ],
    [
      "n212::n150",
      "0/0/0",
      "Design detail column incorrectly paired to the whole code row including the rail",
    ],
  ],
  "proposal-pending": [
    [
      "n212::n141::n1",
      "0/0/0/2/0/0",
      "Different controls: design ellipsis menu versus code sidecar hexagon",
    ],
    [
      "n212::n142",
      "0",
      "Design inner body incorrectly paired to the entire capture root",
    ],
    [
      "n212::n150",
      "0/0/0",
      "Design detail column incorrectly paired to the whole code row including the rail",
    ],
  ],
  empty: [
    [
      "n284::n270::n1",
      "0/0/0/2/0/0",
      "Different controls: design ellipsis menu versus code sidecar hexagon",
    ],
  ],
};
const cell = (v: unknown) => {
  let s = String(v ?? "").replace(/[\t\r\n]+/g, " ");
  if (/^[=+@-]/.test(s)) s = "'" + s;
  return s;
};
const rows = [
    [
      "state",
      "reportHash",
      "drift",
      "kind",
      "designNode",
      "codeNode",
      "property",
      "design",
      "code",
      "review",
      "note",
    ],
  ],
  summary = [];
for (const state of [
  "at-rest",
  "track-selected",
  "proposal-pending",
  "empty",
]) {
  const r = JSON.parse(
    await readFile(path.join(out, state, "drift-report.json"), "utf8"),
  );
  let falseFindings = 0;
  const groups = new Set<string>();
  for (const d of r.drifts) {
    const flagged = falsePairs[state]?.find(
      ([a, b]) => a === d.designNode && b === d.codeNode,
    );
    if (flagged) falseFindings++;
    groups.add(`${d.designNode ?? ""}|${d.codeNode ?? ""}`);
    const review =
      r.verdict === "not-provable"
        ? "diagnostic-only"
        : flagged
          ? "false-correspondence"
          : d.kind === "missing" || d.kind === "extra"
            ? "unmatched-structure"
            : "paired-computed-difference";
    const note =
      r.verdict === "not-provable"
        ? r.reason
        : flagged
          ? flagged[2]
          : d.kind === "missing" || d.kind === "extra"
            ? "No reliable counterpart; this is a node-level structural finding, not a separately established product defect"
            : "Correspondence reviewed against screenshots and labels; values are captured computed/box differences";
    rows.push([
      state,
      r.reportHash,
      d.id,
      d.kind,
      d.designNode,
      d.codeNode,
      d.property,
      JSON.stringify(d.design),
      JSON.stringify(d.code),
      review,
      note,
    ]);
  }
  summary.push({
    state,
    reportHash: r.reportHash,
    rawFindings: r.drifts.length,
    correspondenceGroups: groups.size,
    knownFalseCorrespondences: falsePairs[state]?.length ?? 0,
    knownFalsePropertyFindings: falseFindings,
    qualification:
      state === "at-rest"
        ? "All findings diagnostic; state unavailable"
        : "Known false findings are a lower bound. Structural findings and repeated inherited properties are not independent defects.",
  });
}
await writeFile(
  path.join(out, "visual-audit.tsv"),
  rows.map((r) => r.map(cell).join("\t")).join("\n") + "\n",
);
await writeFile(
  path.join(out, "visual-audit-summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
console.table(
  summary.map(
    ({
      state,
      rawFindings,
      knownFalseCorrespondences,
      knownFalsePropertyFindings,
    }) => ({
      state,
      rawFindings,
      knownFalseCorrespondences,
      knownFalsePropertyFindings,
    }),
  ),
);
