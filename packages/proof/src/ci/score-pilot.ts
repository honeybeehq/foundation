/** One released-label pass over immutable CI reports. Never feeds labels into matching. */
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readCapture } from "../compare/index.ts";
import { csv, defectMetrics } from "../compare/ground-truth.ts";
import { checkHash } from "../compare/canonical.ts";
const [manifestFile, out, labelsCommit] = process.argv.slice(2);
if (!manifestFile || !out || !labelsCommit)
  throw Error("score-pilot MANIFEST OUTPUT_DIRECTORY RELEASED_LABEL_COMMIT");
try {
  await access(out + "/inputs.json");
  throw Error(
    "Pilot score already started; do not rescore after seeing labels",
  );
} catch (e: any) {
  if (e.code !== "ENOENT") throw e;
}
const frozen = "168a0286";
execFileSync("git", [
  "diff",
  "--exit-code",
  frozen,
  "--",
  "packages/proof/src/compare/match.ts",
  "packages/proof/src/compare/defects.ts",
  "packages/proof/src/compare/index.ts",
  "packages/proof/src/compare/style.ts",
  "packages/proof/src/compare/ground-truth.ts",
]);
const manifest: { case: string; report: string; labels: string }[] = JSON.parse(
  await readFile(manifestFile, "utf8"),
);
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const inputs = await Promise.all(
  manifest.map(async (e) => ({
    ...e,
    reportSha256: digest(await readFile(e.report)),
    labelsSha256: digest(await readFile(e.labels)),
  })),
);
await mkdir(out, { recursive: true });
await writeFile(
  out + "/inputs.json",
  JSON.stringify(
    {
      frozenComparator: frozen,
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      labelsCommit,
      sourceRun: "40469303506.1",
      inputs,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
const rows = [];
for (const e of manifest) {
  const r = JSON.parse(await readFile(e.report, "utf8"));
  if (!checkHash(r) || !r.provable)
    throw Error("Invalid or not-provable CI report");
  const a = await readCapture(
      path.resolve(path.dirname(e.report), r.inputs.design),
    ),
    b = await readCapture(path.resolve(path.dirname(e.report), r.inputs.code));
  const labels = csv(await readFile(e.labels, "utf8"));
  const row = {
    case: e.case,
    reportHash: r.reportHash,
    optimistic: defectMetrics(r.defects, r.drifts, labels, a.nodes, b.nodes),
    strict: defectMetrics(r.defects, r.drifts, labels, a.nodes, b.nodes, {
      strictScope: true,
    }),
  };
  rows.push(row);
  await writeFile(
    path.join(out, e.case + ".json"),
    JSON.stringify(row, null, 2) + "\n",
    { flag: "wx" },
  );
}
await writeFile(out + "/summary.json", JSON.stringify(rows, null, 2) + "\n", {
  flag: "wx",
});
console.log(
  JSON.stringify(
    rows.map((r) => ({
      case: r.case,
      strict: {
        tp: r.strict.tp,
        fp: r.strict.fp,
        fn: r.strict.fn,
        precision: r.strict.precision,
        recall: r.strict.recall,
      },
      optimistic: {
        tp: r.optimistic.tp,
        fp: r.optimistic.fp,
        fn: r.optimistic.fn,
        precision: r.optimistic.precision,
        recall: r.optimistic.recall,
      },
    })),
    null,
    2,
  ),
);
