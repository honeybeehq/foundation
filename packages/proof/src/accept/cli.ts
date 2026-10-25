import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { canonical, checkHash } from "../compare/canonical.ts";
import { readAccepted, makeAcceptance } from "./index.ts";
const [command, id, ...args] = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const reportFile = option("--report"),
  reason = option("--reason"),
  reviewer = option("--reviewer"),
  file = option("--file") ?? ".foundation/accepted.json";
if (command !== "accept" || !id || !reportFile || !reason || !reviewer)
  throw Error(
    "accept DEFECT_ID --report REPORT --reason REASON --reviewer REVIEWER [--file .foundation/accepted.json]",
  );
const report = JSON.parse(await readFile(reportFile, "utf8"));
if (!checkHash(report)) throw Error("Report hash mismatch");
const list = await readAccepted(file),
  entry = makeAcceptance(report, id, reason, reviewer);
list.entries = list.entries.filter(
  (e) => !(e.id === id && canonical(e.scope) === canonical(entry.scope)),
);
list.entries.push(entry);
await mkdir(path.dirname(file), { recursive: true });
await writeFile(file, canonical(list) + "\n");
console.log(
  `Accepted ${id}; commit ${file} for review. Recapture and bind the updated list before verifying.`,
);
