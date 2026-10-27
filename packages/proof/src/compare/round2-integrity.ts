import { readFile, writeFile } from "node:fs/promises";
import { checkHash, seal, canonical } from "./canonical.ts";
import { compareDirectories } from "./index.ts";
const out = process.argv[2] ?? "packages/proof/src/compare/evidence/round2";
const integrity = [];
for (const state of ["track-selected", "proposal-pending", "empty"])
  for (const mode of ["ids", "no-ids"]) {
    const f = `${out}/${state}-${mode}.json`;
    const r = JSON.parse(await readFile(f, "utf8"));
    const ids = r.defects.flatMap((d: any) => d.findings).sort();
    if (
      !checkHash(r) ||
      JSON.stringify(ids) !==
        JSON.stringify(r.drifts.map((d: any) => d.id).sort()) ||
      new Set(r.defects.map((d: any) => d.id)).size !== r.defects.length
    )
      throw Error(f + " invariant failed");
    const tampered = structuredClone(r);
    tampered.summary.uniqueDefects++;
    if (checkHash(tampered)) throw Error("Tamper accepted");
    integrity.push({
      state,
      mode,
      hash: true,
      rawPartition: true,
      uniqueIds: true,
      tamperRejected: true,
    });
  }
const base =
  (process.argv[3] ?? ".audit/r2-anchors") + "/tracks-pane/at-rest/1416x720@1";
const rest = await compareDirectories(
  base + "/design",
  base + "/code",
  ".audit/r2-proof/at-rest",
);
if (rest.verdict !== "not-provable")
  throw Error("At rest must remain unavailable");
await writeFile(out + "/at-rest-ids.json", canonical(rest) + "\n");
await writeFile(
  out + "/integrity.json",
  JSON.stringify(integrity, null, 2) + "\n",
);
console.log(
  "6 report hashes, raw partitions, defect ID uniqueness and tamper checks pass; at-rest stays not-provable",
);
