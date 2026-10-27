/** Sensitivity audit only: this file never changes a matcher result. */
import { readFile, writeFile } from "node:fs/promises";
import { csv, defectMetrics } from "./ground-truth.ts";
import { readCapture } from "./index.ts";
import type { Defect } from "./types.ts";
const root = process.argv[2] ?? ".audit/r2-anchors",
  out = process.argv[3] ?? "packages/proof/src/compare/evidence/round2";
const rows = [];
for (const state of ["track-selected", "proposal-pending", "empty"])
  for (const mode of ["ids", "no-ids"]) {
    const report = JSON.parse(
      await readFile(`${out}/${state}-${mode}.json`, "utf8"),
    );
    const [design, code] = await Promise.all(
      ["design", "code"].map((side) =>
        readCapture(`${root}/tracks-pane/${state}/1416x720@1/${side}`),
      ),
    );
    const labels = csv(
      await readFile(
        `packages/proof/fixtures/ground-truth/${state}.defects.csv`,
        "utf8",
      ),
    ).filter((l) => l.kind !== "environment");
    const broad = (l: Record<string, string>) =>
      [l.design_layer, l.code_layer].some((s) =>
        s?.split(";").some((p) => ["0", "0/0", "*"].includes(p)),
      );
    const metrics = defectMetrics(
      report.defects,
      report.drifts,
      labels,
      design!.nodes,
      code!.nodes,
    );
    const coverage = (report.defects as Defect[])
      .filter((d) => d.classification !== "environment")
      .map((d) => ({
        id: d.id,
        classification: d.classification,
        cause: d.cause,
        findings: d.findings.length,
        labels: labels
          .filter(
            (l) =>
              defectMetrics(
                [{ ...d, classification: "product" }],
                report.drifts,
                [l],
                design!.nodes,
                code!.nodes,
              ).tp > 0,
          )
          .map((l) => l.id!),
      }));
    const productUnion = new Set(
      coverage
        .filter((d) => d.classification === "product")
        .flatMap((d) => d.labels),
    );
    const allUnion = new Set(coverage.flatMap((d) => d.labels));
    const uncertain = coverage.filter(
      (d) => d.classification === "uncertain",
    ).length;
    const narrow = defectMetrics(
      report.defects,
      report.drifts,
      labels.filter((l) => !broad(l)),
      design!.nodes,
      code!.nodes,
    );
    const row = {
      state,
      mode,
      product: metrics.predicted,
      uncertain,
      oneToOneSupport: metrics.tp,
      productPrecision: metrics.precision,
      productRecall: metrics.recall,
      inclusivePrecision: metrics.tp / (metrics.predicted + uncertain),
      productLabelCoverage: productUnion.size,
      allLabelCoverage: allUnion.size,
      onlyUncertainLabels: [...allUnion].filter((id) => !productUnion.has(id)),
      compositeProductCandidates: coverage.filter(
        (d) => d.classification === "product" && d.labels.length > 1,
      ).length,
      broadLabelsExcluded: labels.filter(broad).map((l) => l.id),
      narrowScopeSupport: narrow.tp,
      narrowScopePrecision: narrow.precision,
      narrowScopeRecall: narrow.recall,
      coverage,
    };
    rows.push(row);
    await writeFile(
      `${out}/${state}-${mode}-coverage.json`,
      JSON.stringify(row, null, 2) + "\n",
    );
  }
await writeFile(
  `${out}/coverage-summary.json`,
  JSON.stringify(
    rows.map(({ coverage, ...r }) => r),
    null,
    2,
  ) + "\n",
);
console.table(
  rows.map(
    ({
      state,
      mode,
      product,
      uncertain,
      oneToOneSupport,
      inclusivePrecision,
      productLabelCoverage,
      allLabelCoverage,
      narrowScopeSupport,
    }) => ({
      state,
      mode,
      product,
      uncertain,
      oneToOneSupport,
      inclusivePrecision,
      productLabelCoverage,
      allLabelCoverage,
      narrowScopeSupport,
    }),
  ),
);
