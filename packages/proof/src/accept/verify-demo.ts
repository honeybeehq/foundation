/** Replay a real downloaded Actions artifact; briefly stale the local accepted entry, then restore it. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { verify } from "../report/index.ts";
const [manifest, codeRepo, policyFile, out] = process.argv.slice(2);
if (!manifest || !codeRepo || !policyFile || !out)
  throw Error("verify-demo MANIFEST CODE_REPO TRUSTED_POLICY OUTPUT_DIRECTORY");
const file = path.join(codeRepo, ".foundation/accepted.json"),
  original = await readFile(file, "utf8"),
  list = JSON.parse(original),
  policy = JSON.parse(await readFile(policyFile, "utf8"));
if (!list.entries?.length) throw Error("Demo requires an accepted entry");
await mkdir(out, { recursive: true });
const accepted = await verify(manifest, {
  codeRepo,
  designRepo: codeRepo,
  policy,
});
console.log("CURRENT ACCEPTED LIST\n" + JSON.stringify(accepted, null, 2));
await writeFile(
  path.join(out, "verify-accepted.json"),
  JSON.stringify(accepted, null, 2) + "\n",
);
if (!accepted.accepted.length)
  throw Error("No accepted difference was verified");
try {
  list.entries[0].design.head = "0".repeat(64);
  await writeFile(file, JSON.stringify(list));
  const stale = await verify(manifest, {
    codeRepo,
    designRepo: codeRepo,
    policy,
  });
  console.log(
    "STALE ACCEPTED ENTRY (deliberately edited list; dirty-list and hash failures also expected)\n" +
      JSON.stringify(stale, null, 2),
  );
  await writeFile(
    path.join(out, "verify-stale.json"),
    JSON.stringify(stale, null, 2) + "\n",
  );
  if (
    !stale.errors.some((e) =>
      e.includes(
        "design changed since this difference was accepted; re-review or update the design",
      ),
    )
  )
    throw Error("Stale entry did not fail");
} finally {
  await writeFile(file, original);
}
