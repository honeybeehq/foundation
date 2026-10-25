import { createHash } from "node:crypto";
import { rm, rename } from "node:fs/promises";
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
const require = createRequire(import.meta.url);
const { build } = require(
  require.resolve("esbuild", {
    paths: [path.dirname(require.resolve("tsx/package.json"))],
  }),
);
const root = path.resolve(import.meta.dirname, "../../.."),
  out = path.join(root, "packages/proof/dist");
if (
  execFileSync(
    "git",
    [
      "status",
      "--porcelain",
      "--",
      "packages/proof/src",
      "packages/proof/scripts",
    ],
    { cwd: root, encoding: "utf8" },
  ).trim()
)
  throw Error("Commit proof sources before packaging");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
await mkdir(out, { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: [path.join(root, "packages/proof/src/ci/cli.ts")],
  outfile: path.join(out, "cli.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  metafile: true,
  banner: { js: "#!/usr/bin/env node" },
});
if (Object.keys(result.metafile.inputs).some((p) => p.includes("/engine/")))
  throw Error("The installable CLI must not contain the Foundation engine");
await writeFile(
  path.join(out, "package.json"),
  JSON.stringify(
    {
      name: "foundation-proof",
      version: "0.2.0-proto.3",
      type: "module",
      bin: { "foundation-proof": "cli.mjs" },
      dependencies: {
        playwright: "1.62.0",
        pixelmatch: "7.2.0",
        pngjs: "7.0.0",
      },
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  path.join(out, "bundle-inputs.json"),
  JSON.stringify(Object.keys(result.metafile.inputs), null, 2) + "\n",
);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inputs = await Promise.all(
  Object.keys(result.metafile.inputs)
    .sort()
    .map(async (file) => ({
      file,
      sha256: digest(await readFile(path.resolve(root, file))),
    })),
);
await writeFile(
  path.join(out, "source.json"),
  JSON.stringify(
    {
      foundationCommit: sourceCommit,
      cliSha256: digest(await readFile(path.join(out, "cli.mjs"))),
      bundleInputsSha256: digest(JSON.stringify(inputs)),
      inputs,
    },
    null,
    2,
  ) + "\n",
);
await rm(path.join(out, "npm-shrinkwrap.json"), { force: true });
execFileSync(
  "npm",
  [
    "install",
    "--package-lock-only",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ],
  { cwd: out, stdio: "inherit" },
);
await rename(
  path.join(out, "package-lock.json"),
  path.join(out, "npm-shrinkwrap.json"),
);
execFileSync(
  "pnpm",
  [
    "pack",
    "--pack-destination",
    path.resolve(process.argv[2] ?? path.join(root, ".audit/vendor")),
  ],
  { cwd: out, stdio: "inherit" },
);
