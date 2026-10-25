/** Run real CLI checks against a temporary git repository and genuine Foundation chain. */
import { createHash } from "node:crypto";
import { compareDirectories } from "../compare/index.ts";
import { defaults } from "../compare/types.ts";
import {
  mkdtemp,
  mkdir,
  copyFile,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { loadChain } from "../../../engine/src/index.ts";
import { writeReport, writeManifest, notProvable } from "./index.ts";
const scratch = await mkdtemp(path.join(tmpdir(), "foundation-proof-")),
  root = path.join(scratch, "source");
await mkdir(root);
execFileSync("git", ["init", "-q", root]);
execFileSync("git", [
  "-C",
  root,
  "-c",
  "user.name=Proof",
  "-c",
  "user.email=proof@example.test",
  "commit",
  "--allow-empty",
  "-qm",
  "fixture",
]);
await mkdir(path.join(root, "boards"));
for (const suffix of ["", ".chain"])
  await copyFile(
    "packages/proof/src/compare/evidence/authoritative.fdn.html" + suffix,
    path.join(root, "boards/tracks-pane.fdn.html" + suffix),
  );
execFileSync("git", ["-C", root, "add", "."]);
execFileSync("git", [
  "-C",
  root,
  "-c",
  "user.name=Proof",
  "-c",
  "user.email=proof@example.test",
  "commit",
  "-qm",
  "design fixture",
]);
const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const head = loadChain(
  await readFile(path.join(root, "boards/tracks-pane.fdn.html.chain")),
).head().hash;
const binding = {
  artboard: "tracks-pane/default",
  state: "default",
  viewport: { width: 1280, height: 800, dpr: 1 },
  design: {
    file: "boards/tracks-pane.fdn.html",
    head,
    binding: "chain-head",
    htmlSha256: createHash("sha256")
      .update(await readFile(path.join(root, "boards/tracks-pane.fdn.html")))
      .digest("hex"),
  },
  code: { repo: "fixture", root: "TracksPane", commit },
};
const report = path.join(scratch, "replay/drift-report.json"),
  manifest = path.join(scratch, "proof-manifest.json");
const measuredSource =
  "packages/proof/src/compare/evidence/authoritative/design-capture";
for (const name of ["design", "code"]) {
  const dir = path.join(scratch, name);
  await mkdir(dir);
  for (const file of ["dom.json", "screenshot.png"])
    await copyFile(path.join(measuredSource, file), path.join(dir, file));
  const meta = JSON.parse(
    await readFile(path.join(measuredSource, "meta.json"), "utf8"),
  );
  Object.assign(meta, {
    file: binding.design.file,
    designHead: head,
    htmlSha256: binding.design.htmlSha256,
    binding: "chain-head",
    commit,
    repo: "fixture",
    root: "TracksPane",
  });
  await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta));
}
const measured = await compareDirectories(
  path.join(scratch, "design"),
  path.join(scratch, "code"),
  path.join(scratch, "replay"),
);
const policyFile = path.join(scratch, "policy.json");
const policy = {
  tolerances: defaults,
  required: [
    {
      artboard: binding.artboard,
      state: binding.state,
      viewport: binding.viewport,
    },
  ],
  designBinding: "chain-head",
  requireHtmlSha256: true,
};
await writeFile(policyFile, JSON.stringify(policy));
const match = {
  ...measured,
  ...binding,
  schema: "fdn-drift/0",
  provable: true,
  verdict: "match",
  tolerances: defaults,
  pixels: measured.pixels,
  drifts: measured.drifts,
};
const runs: unknown[] = [];
async function run(
  name: string,
  value: Record<string, unknown>,
  expected: number,
) {
  await writeReport(report, value);
  await writeManifest(manifest, [report]);
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "tsx",
      "packages/proof/src/report/cli.ts",
      "verify",
      manifest,
      root,
      root,
      policyFile,
    ],
    { encoding: "utf8" },
  );
  runs.push({
    name,
    exitCode: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  });
  if (result.status !== expected)
    throw Error(`${name}: expected exit ${expected}, got ${result.status}`);
}
await run("match", match, 0);
await run(
  "pixel-drift",
  { ...match, pixels: { diffRatio: 0.02 }, verdict: "drift" },
  1,
);
await run(
  "stale-code",
  { ...match, code: { ...binding.code, commit: "0".repeat(40) } },
  1,
);
await run(
  "stale-design",
  { ...match, design: { ...binding.design, head: "0".repeat(64) } },
  1,
);
await run(
  "not-provable",
  notProvable(binding, "Component requires an unstubbed server connection"),
  1,
);
await run(
  "loose-policy",
  { ...match, tolerances: { ...defaults, pixelRatio: 1 } },
  1,
);
await run(
  "missing-html-hash",
  {
    ...match,
    design: { file: binding.design.file, head, binding: "chain-head" },
  },
  1,
);
await writeFile(
  policyFile,
  JSON.stringify({
    ...policy,
    required: [
      ...policy.required,
      { ...policy.required[0], state: "missing-state" },
    ],
  }),
);
await run("missing-state", match, 1);
await writeFile(policyFile, JSON.stringify(policy));
await writeFile(path.join(root, "extra-code.ts"), "dirty");
await run("dirty-source", match, 1);
await (
  await import("node:fs/promises")
).unlink(path.join(root, "extra-code.ts"));
const shaHead = createHash("sha256")
  .update(await readFile(path.join(root, "boards/tracks-pane.fdn.html.chain")))
  .digest("hex");
const designMetaFile = path.join(scratch, "design/meta.json"),
  designMeta = JSON.parse(await readFile(designMetaFile, "utf8"));
await writeFile(
  designMetaFile,
  JSON.stringify({
    ...designMeta,
    designHead: shaHead,
    binding: "chain-sha256",
  }),
);
await writeFile(
  policyFile,
  JSON.stringify({ ...policy, designBinding: "chain-sha256" }),
);
const shaMatch = await compareDirectories(
  path.join(scratch, "design"),
  path.join(scratch, "code"),
  path.join(scratch, "replay"),
);
await run("chain-sha256-match", shaMatch, 0);
await run(
  "chain-sha256-stale",
  { ...shaMatch, design: { ...shaMatch.design, head: "0".repeat(64) } },
  1,
);
await writeFile(designMetaFile, JSON.stringify(designMeta));
await writeFile(policyFile, JSON.stringify(policy));
await compareDirectories(
  path.join(scratch, "design"),
  path.join(scratch, "code"),
  path.join(scratch, "replay"),
);
await writeReport(report, match);
await writeManifest(manifest, [report]);
const tampered = JSON.parse(await readFile(report, "utf8"));
tampered.state = "tampered";
await writeFile(report, JSON.stringify(tampered));
const tamper = spawnSync(
  "pnpm",
  [
    "exec",
    "tsx",
    "packages/proof/src/report/cli.ts",
    "verify",
    manifest,
    root,
    root,
    policyFile,
  ],
  { encoding: "utf8" },
);
if (tamper.status !== 1) throw Error("Tampering passed");
runs.push({
  name: "tampered-report",
  exitCode: tamper.status,
  stdout: tamper.stdout.trim(),
});
await mkdir("packages/proof/src/report/evidence", { recursive: true });
await writeFile(
  "packages/proof/src/report/evidence/verify-runs.json",
  JSON.stringify(runs, null, 2) + "\n",
);
await writeFile(
  "packages/proof/src/report/evidence/not-provable.json",
  JSON.stringify(
    notProvable(binding, "Component requires an unstubbed server connection"),
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify(runs, null, 2));
