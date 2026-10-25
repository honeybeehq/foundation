import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { loadChain } from "../../../engine/src/index.ts";
import { canonical, hash, seal, checkHash } from "../compare/canonical.ts";
export { canonical, hash, seal, checkHash } from "../compare/canonical.ts";
export async function writeReport(
  file: string,
  value: Record<string, unknown>,
) {
  const report = seal(value);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, canonical(report) + "\n");
  return report;
}
export async function writeManifest(file: string, reports: string[]) {
  const entries = await Promise.all(
    reports.map(async (f) => {
      const r = JSON.parse(await readFile(f, "utf8"));
      if (!checkHash(r)) throw Error(`Invalid report hash: ${f}`);
      return {
        path: path.relative(path.dirname(file), f),
        reportHash: r.reportHash,
        artboard: r.artboard,
        state: r.state,
        viewport: r.viewport,
      };
    }),
  );
  const body = { schema: "fdn-proof-manifest/0", reports: entries };
  const manifest = { ...body, manifestHash: hash(body) };
  await writeFile(file, canonical(manifest) + "\n");
  return manifest;
}
export function notProvable(binding: Record<string, unknown>, reason: string) {
  if (!reason.trim()) throw Error("A not-provable report needs a reason");
  return seal({
    ...binding,
    schema: "fdn-drift/0",
    provable: false,
    verdict: "not-provable",
    reason,
    notProvable: {
      reason,
      detail: reason,
      fix: "Provide an isolated renderable fixture, then capture and verify this state again.",
    },
    drifts: [],
  });
}
export interface VerifyPolicy {
  tolerances: Record<string, number>;
  required: {
    artboard: string;
    state: string;
    viewport: { width: number; height: number; dpr: number };
  }[];
  designBinding: "chain-head" | "chain-sha256";
  requireHtmlSha256: true;
}
export async function verify(
  manifestFile: string,
  options: { codeRepo: string; designRepo: string; policy: VerifyPolicy },
) {
  const errors: string[] = [],
    manifest = JSON.parse(await readFile(manifestFile, "utf8")),
    { manifestHash, ...body } = manifest;
  if (manifest.schema !== "fdn-proof-manifest/0" || hash(body) !== manifestHash)
    errors.push("Manifest hash/schema mismatch");
  if (!Array.isArray(manifest.reports) || !manifest.reports.length)
    errors.push("Manifest has no reports");
  const policy = options.policy;
  if (
    !policy ||
    !policy.required?.length ||
    policy.requireHtmlSha256 !== true ||
    !["chain-head", "chain-sha256"].includes(policy.designBinding) ||
    !policy.tolerances ||
    ["pixelRatio", "boxPx", "stylePx", "colorDeltaE", "pixelThreshold"].some(
      (k) =>
        !Number.isFinite(policy.tolerances[k]) || policy.tolerances[k]! < 0,
    )
  )
    throw Error("Verification requires a complete trusted policy");
  const identity = (v: any) =>
    canonical({ artboard: v.artboard, state: v.state, viewport: v.viewport });
  for (const required of policy.required)
    if (
      !(manifest.reports ?? []).some(
        (e: any) => identity(e) === identity(required),
      )
    )
      errors.push(`Missing required capture: ${identity(required)}`);
  const identities = (manifest.reports ?? []).map(identity);
  if (new Set(identities).size !== identities.length)
    errors.push("Duplicate capture identity");
  if (
    execFileSync("git", ["-C", options.codeRepo, "status", "--porcelain"], {
      encoding: "utf8",
    }).trim()
  )
    errors.push("Code checkout is dirty");
  const head = execFileSync(
    "git",
    ["-C", options.codeRepo, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  for (const entry of manifest.reports ?? []) {
    try {
      const file = path.resolve(path.dirname(manifestFile), entry.path),
        r = JSON.parse(await readFile(file, "utf8"));
      if (!checkHash(r) || r.reportHash !== entry.reportHash)
        errors.push(`${entry.path}: report hash mismatch`);
      if (r.schema !== "fdn-drift/0")
        errors.push(`${entry.path}: unsupported schema`);
      if (
        canonical({
          artboard: r.artboard,
          state: r.state,
          viewport: r.viewport,
        }) !==
        canonical({
          artboard: entry.artboard,
          state: entry.state,
          viewport: entry.viewport,
        })
      )
        errors.push(`${entry.path}: manifest identity mismatch`);
      for (const [k, max] of Object.entries(
        r.provable === false ? {} : policy.tolerances,
      ))
        if (!Number.isFinite(r.tolerances?.[k]) || r.tolerances[k] > max)
          errors.push(
            `${entry.path}: tolerance ${k} exceeds policy or is missing`,
          );
      if (r.design?.binding !== policy.designBinding)
        errors.push(`${entry.path}: design binding differs from policy`);
      if (!/^[a-f0-9]{64}$/.test(r.design?.htmlSha256 ?? ""))
        errors.push(`${entry.path}: missing design HTML binding`);
      if (!r.code?.commit || r.code.commit !== head)
        errors.push(`${entry.path}: stale code binding`);
      if (
        r.design?.htmlSha256 &&
        createHash("sha256")
          .update(
            await readFile(path.resolve(options.designRepo, r.design.file)),
          )
          .digest("hex") !== r.design.htmlSha256
      )
        errors.push(`${entry.path}: stale design HTML binding`);
      if (!r.design?.file || !r.design?.head)
        errors.push(`${entry.path}: missing design binding`);
      else {
        const bytes = await readFile(
          path.resolve(options.designRepo, r.design.file + ".chain"),
        );
        if (
          !["chain-head", "chain-sha256", undefined].includes(r.design.binding)
        )
          errors.push(`${entry.path}: unknown design binding`);
        if (
          (r.design.binding === "chain-sha256"
            ? createHash("sha256").update(bytes).digest("hex")
            : loadChain(bytes).head().hash) !== r.design.head
        )
          errors.push(`${entry.path}: stale design binding`);
      }
      if (r.provable === true) {
        if (!r.inputs?.design || !r.inputs?.code)
          errors.push(`${entry.path}: missing replay captures`);
        else {
          const { readCapture, compare, captureHash } =
            await import("../compare/index.ts");
          const [d, c] = await Promise.all([
            readCapture(path.resolve(path.dirname(file), r.inputs.design)),
            readCapture(path.resolve(path.dirname(file), r.inputs.code)),
          ]);
          if (
            captureHash(d) !== r.inputs.designHash ||
            captureHash(c) !== r.inputs.codeHash
          )
            errors.push(`${entry.path}: capture hash mismatch`);
          const actual = compare(d, c, r.tolerances).report;
          if (
            actual.code.commit !== r.code.commit ||
            actual.design.head !== r.design.head ||
            actual.design.htmlSha256 !== r.design.htmlSha256 ||
            identity(actual) !== identity(r)
          )
            errors.push(`${entry.path}: capture source binding mismatch`);
          if (
            actual.verdict !== r.verdict ||
            canonical(actual.drifts) !== canonical(r.drifts) ||
            actual.pixels.diffRatio !== r.pixels?.diffRatio
          )
            errors.push(`${entry.path}: measurement replay mismatch`);
          if (actual.verdict !== "match")
            errors.push(
              `${entry.path}: replay found drift or incomplete captures`,
            );
        }
      }
      if (r.verdict === "not-provable" || r.provable !== true)
        errors.push(
          `${entry.path}: not-provable: ${r.reason || "reason missing"}`,
        );
      else if (
        !r.tolerances ||
        Object.values(r.tolerances).some(
          (v) => typeof v !== "number" || !Number.isFinite(v) || v < 0,
        ) ||
        r.verdict !== "match" ||
        !Array.isArray(r.drifts) ||
        r.drifts.length ||
        !Number.isFinite(r.pixels?.diffRatio) ||
        !Number.isFinite(r.tolerances?.pixelRatio) ||
        r.pixels.diffRatio > r.tolerances.pixelRatio
      )
        errors.push(`${entry.path}: drift exceeds tolerance`);
    } catch (e) {
      errors.push(
        `${entry.path}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return {
    passed: errors.length === 0,
    errors,
    reports: manifest.reports?.length ?? 0,
  };
}
