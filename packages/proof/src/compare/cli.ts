import { compareDirectories } from "./index.ts";
const [design, code, out] = process.argv.slice(2);
if (!design || !code || !out)
  throw Error("Usage: tsx packages/proof/src/compare/cli.ts DESIGN CODE OUT");
const r = await compareDirectories(design, code, out);
console.log(
  JSON.stringify({
    verdict: r.verdict,
    drifts: r.drifts.length,
    diffRatio: r.pixels.diffRatio,
    timingsMs: r.timingsMs,
  }),
);
