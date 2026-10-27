/** Audit unmatched product candidates, never a matcher input. */
import { readFile, writeFile } from "node:fs/promises";
import type { Defect, Drift } from "./types.ts";
const [reportFile, metricsFile, out] = process.argv.slice(2);
if (!reportFile || !metricsFile || !out)
  throw Error("Need report.json metrics.json output.tsv");
const report = JSON.parse(await readFile(reportFile, "utf8"));
const metrics = JSON.parse(await readFile(metricsFile, "utf8"));
const raw = new Map<string, Drift>(report.drifts.map((d: Drift) => [d.id, d]));
const counts: Record<string, number> = {};
const rows = (metrics.defects.falsePositives as Defect[]).map((d) => {
  const findings = d.findings.map((id) => raw.get(id)!);
  const properties = [...new Set(findings.map((r) => r.property))];
  const category =
    d.classification === "environment"
      ? "environment counted"
      : d.classification === "uncertain"
        ? "uncertain counted"
        : d.kind === "missing"
          ? "missing structure not folded"
          : d.kind === "extra"
            ? "extra structure not folded"
            : d.kind === "layout"
              ? "geometry or layout consequence"
              : properties.some((p) =>
                    /^(font-|line-height|text-|white-space|letter-spacing|color$)/.test(
                      p,
                    ),
                  )
                ? "inherited or text styling"
                : "paint or box styling";
  counts[category] = (counts[category] ?? 0) + 1;
  return [
    d.id,
    category,
    d.cause,
    d.layer.design ?? "",
    d.layer.code ?? "",
    properties.join(";"),
    d.findings.join(";"),
    d.summary,
  ];
});
const clean = (s: unknown) => String(s).replace(/[\t\r\n]/g, " ");
await writeFile(
  out,
  [
    [
      "id",
      "category",
      "rule",
      "design",
      "code",
      "properties",
      "rawFindings",
      "summary",
    ],
    ...rows,
  ]
    .map((r) => r.map(clean).join("\t"))
    .join("\n") + "\n",
);
console.log(JSON.stringify({ falsePositives: rows.length, counts }, null, 2));
