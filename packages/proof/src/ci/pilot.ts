import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { canonical } from "../compare/canonical.ts";
import { readCapture, captureHash } from "../compare/index.ts";
import { policyFromLinks } from "../report/policy.ts";
import type { VerifyPolicy } from "../report/index.ts";
export interface Pilot {
  schema: "fdn-pilot/0";
  cases: { links: string }[];
}
export async function readPilot(file: string, repo: string) {
  const pilot = JSON.parse(
    await readFile(path.resolve(repo, file), "utf8"),
  ) as Pilot;
  if (pilot.schema !== "fdn-pilot/0" || !pilot.cases?.length)
    throw Error("Expected nonempty fdn-pilot/0 cases");
  return Promise.all(
    pilot.cases.map(async (c) => ({
      file: c.links,
      links: JSON.parse(await readFile(path.resolve(repo, c.links), "utf8")),
    })),
  );
}
export const identity = (r: any) =>
  canonical({ artboard: r.artboard, state: r.state, viewport: r.viewport });
export async function pilotPolicy(
  repo: string,
  config: string,
  baseline: string,
  tool: string,
  source: string,
): Promise<
  VerifyPolicy & {
    pilot: string;
    links: Record<string, string>;
    tool: Record<string, any>;
  }
> {
  const cases = await readPilot(config, repo),
    required: VerifyPolicy["required"] = [],
    bindings: Record<string, { htmlSha256: string; head: string }> = {},
    captures: Record<string, string> = {},
    environments: NonNullable<VerifyPolicy["captureEnvironments"]> = {},
    links: Record<string, string> = {};
  let designBinding: VerifyPolicy["designBinding"] | undefined;
  let tolerances: VerifyPolicy["tolerances"] | undefined;
  for (const c of cases) {
    const p = policyFromLinks(c.links);
    if (designBinding && designBinding !== p.designBinding)
      throw Error("Pilot links must use the same design binding mode");
    designBinding = p.designBinding;
    tolerances ??= p.tolerances;
    links[c.file] = createHash("sha256")
      .update(await readFile(path.resolve(repo, c.file)))
      .digest("hex");
    for (const scope of p.required) {
      const key = identity(scope);
      if (captures[key]) throw Error("Duplicate pilot capture identity");
      const rel = path.join(
        scope.artboard,
        scope.state,
        `${scope.viewport.width}x${scope.viewport.height}@${scope.viewport.dpr}`,
        "design",
      );
      const d = await readCapture(path.resolve(repo, baseline, rel));
      if (
        d.meta.designHead !== c.links.designHead ||
        !c.links.designHtmlSha256 ||
        d.meta.htmlSha256 !== c.links.designHtmlSha256 ||
        (d.meta.binding ?? "chain-head") !== p.designBinding
      )
        throw Error(`Baseline differs from linked design: ${key}`);
      required.push(scope);
      captures[key] = captureHash(d);
      bindings[key] = {
        htmlSha256: d.meta.htmlSha256,
        head: d.meta.designHead,
      };
      if (p.captureEnvironment) environments[key] = p.captureEnvironment;
    }
  }
  const { inputs, ...provenance } = JSON.parse(await readFile(source, "utf8"));
  return {
    pilot: config,
    links,
    tolerances: tolerances!,
    required,
    designBinding: designBinding!,
    requireHtmlSha256: true,
    baseline: { bindings, captures },
    captureEnvironments: environments,
    tool: {
      file: tool,
      sha256: createHash("sha256")
        .update(await readFile(path.resolve(repo, tool)))
        .digest("hex"),
      ...provenance,
    },
    environmentCauses: [
      "declared-linux-font-substitution",
      "equivalent-rendered-font-stack",
      "equivalent-borderless-box-model",
      "positioning-technique",
      "computed-directional-alignment",
    ],
  };
}
