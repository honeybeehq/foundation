/** Reproduce every real Tracks report; run after collecting T2's final samples. */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { compareDirectories } from "./index.ts";
import { canonical } from "./canonical.ts";
import { policyFromLinks } from "../report/policy.ts";
import { writeManifest } from "../report/index.ts";
const viewport = process.argv[2] || "1416x720@1";
const out = "packages/proof/fixtures/sample-reports";
const states = ["at-rest", "track-selected", "proposal-pending", "empty"];
const rows = [],
  reports = [];
for (const state of states) {
  const base = path.join(
      "packages/proof/fixtures/sample-captures/tracks-pane",
      state,
      viewport,
    ),
    destination = path.join(out, state),
    start = performance.now();
  const r = await compareDirectories(
    path.join(base, "design"),
    path.join(base, "code"),
    destination,
  );
  const kinds = Object.fromEntries(
    ["layout", "style", "token", "text", "missing", "extra"].map((k) => [
      k,
      r.drifts.filter((d) => d.kind === k).length,
    ]),
  );
  rows.push({
    state,
    viewport: r.viewport,
    verdict: r.verdict,
    reason: "reason" in r ? r.reason : null,
    drifts: r.drifts.length,
    kinds,
    matches: r.matches.length,
    idMatches: r.matches.filter((m) => m.kind === "id").length,
    heuristicMatches: r.matches.filter((m) => m.kind === "heuristic").length,
    pixelRatio: r.pixels.diffRatio,
    compareMs: r.timingsMs.compare,
    totalMs: performance.now() - start,
    design: r.design,
    code: r.code,
    reportHash: r.reportHash,
  });
  reports.push(path.join(destination, "drift-report.json"));
}
await writeManifest(path.join(out, "proof-manifest.json"), reports);
await writeFile(
  path.join(out, "proof-policy.json"),
  canonical(
    policyFromLinks(
      JSON.parse(
        await readFile(
          process.argv[3] ||
            "packages/proof/src/report/evidence/reviewed-links.json",
          "utf8",
        ),
      ),
    ),
  ) + "\n",
);
await writeFile(
  path.join(out, "summary.json"),
  JSON.stringify(rows, null, 2) + "\n",
);
console.table(
  rows.map(({ state, verdict, drifts, pixelRatio, compareMs }) => ({
    state,
    verdict,
    drifts,
    pixelRatio,
    compareMs,
  })),
);
