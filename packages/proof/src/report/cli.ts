import { policyFromLinks } from "./policy.ts";
import { canonical } from "./index.ts";
import { writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { writeReport, writeManifest, verify } from "./index.ts";
const [command, ...args] = process.argv.slice(2);
if (command === "policy") {
  const [links, out] = args;
  if (!links || !out) throw Error("policy TRUSTED_LINKS OUT_JSON");
  await writeFile(
    out,
    canonical(policyFromLinks(JSON.parse(await readFile(links, "utf8")))) +
      "\n",
  );
  console.log("Wrote policy from reviewed links");
} else if (command === "seal") {
  const [file, ...reports] = args;
  if (!file || !reports.length) throw Error("seal MANIFEST REPORT...");
  for (const r of reports)
    await writeReport(r, JSON.parse(await readFile(r, "utf8")));
  await writeManifest(file, reports);
  console.log(`Sealed ${reports.length} reports`);
} else if (command === "verify") {
  const [manifest, codeRepo = ".", designRepo = ".", policyFile] = args;
  if (!manifest || !policyFile)
    throw Error("verify MANIFEST CODE_REPO DESIGN_REPO POLICY_JSON");
  const result = await verify(manifest, {
    codeRepo,
    designRepo,
    policy: JSON.parse(await readFile(policyFile, "utf8")),
  });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.passed ? 0 : 1;
} else throw Error("Usage: report/cli.ts policy|seal|verify ...");
