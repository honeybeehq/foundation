import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import {
  compareDirectories,
  readCapture,
  captureHash,
} from "../compare/index.ts";
import { readPilot, identity, pilotPolicy } from "./pilot.ts";
import {
  readReview,
  candidateOf,
  reviewState,
  runReviewMs,
  type ReviewRun,
} from "../review/index.ts";
import { hash } from "../compare/canonical.ts";
import { canonical } from "../compare/canonical.ts";
import { bindAccepted, readAccepted } from "../accept/index.ts";
import { writeManifest, writeReport, verify } from "../report/index.ts";
import { jobSummary } from "../report/summary.ts";
const [command, ...args] = process.argv.slice(2);
const opt = (k: string, f?: string) =>
  args.includes(k) ? args[args.indexOf(k) + 1] : f;
if (
  command === "check" &&
  !["advisory", "required"].includes(opt("--mode", "advisory")!)
)
  throw Error("--mode must be advisory or required");
if (command === "capture-code") {
  process.argv = [...process.argv.slice(0, 2), ...args];
  await import("../capture/code-cli.ts");
} else if (command === "accept") {
  process.argv = [...process.argv.slice(0, 2), "accept", ...args];
  await import("../accept/cli.ts");
} else if (["review", "review-start", "review-end"].includes(command!)) {
  process.argv = [...process.argv.slice(0, 2), command!, ...args];
  await import("../review/cli.ts");
} else if (command === "pilot-policy") {
  const policy = await pilotPolicy(
    path.resolve(opt("--code", ".")!),
    opt("--pilot")!,
    opt("--baseline", ".foundation/baseline")!,
    opt("--tool")!,
    opt("--source")!,
  );
  await writeFile(opt("--out")!, JSON.stringify(policy, null, 2) + "\n");
  console.log("Wrote pilot policy for " + policy.required.length + " captures");
} else if (command === "check") {
  const repo = path.resolve(opt("--code", ".")!),
    baseline = path.resolve(opt("--baseline", ".foundation/baseline")!),
    out = path.resolve(opt("--out", "proof-output")!);
  const policy = JSON.parse(await readFile(opt("--policy")!, "utf8"));
  if (opt("--pilot")) {
    const cases = await readPilot(opt("--pilot")!, repo);
    for (const c of cases) {
      const bytes = await readFile(path.resolve(repo, c.file));
      if (
        !policy.links?.[c.file] ||
        policy.links[c.file] !==
          (await import("node:crypto"))
            .createHash("sha256")
            .update(bytes)
            .digest("hex")
      )
        throw Error("Pilot links differ from reviewed base policy: " + c.file);
      for (const board of c.links.artboards)
        for (const state of board.states) {
          const binding =
            policy.baseline?.bindings?.[
              identity({
                artboard: board.id,
                state: state.name,
                viewport: board.viewport,
              })
            ];
          if (!binding || binding.head !== c.links.designHead)
            throw Error("Pilot design binding differs from base policy");
        }
    }
  } else {
    const links = JSON.parse(
      await readFile(path.join(repo, ".foundation/links.json"), "utf8"),
    );
    if (
      !policy.baseline ||
      links.designHead !== policy.baseline.head ||
      links.designHtmlSha256 !== policy.baseline.htmlSha256
    )
      throw Error(
        "Links design binding differs from trusted base policy; regenerate and review baseline",
      );
  }
  const accepted = await readAccepted(
      path.join(repo, ".foundation/accepted.json"),
    ),
    reports: any[] = [],
    files: string[] = [];
  const started = performance.now();
  for (const required of policy.required) {
    const rel = path.join(
      required.artboard,
      required.state,
      `${required.viewport.width}x${required.viewport.height}@${required.viewport.dpr}`,
    );
    const destination = path.join(out, required.artboard, required.state),
      r = await compareDirectories(
        path.join(baseline, rel, "design"),
        path.join(opt("--captures", "captures")!, rel, "code"),
        destination,
        policy.tolerances,
      );
    const file = path.join(destination, "drift-report.json");
    const bound = bindAccepted(r, accepted, {
      design: await readCapture(path.join(destination, "design-capture")),
      code: await readCapture(path.join(destination, "code-capture")),
    });
    await writeReport(file, bound);
    reports.push(bound);
    files.push(file);
  }
  await writeManifest(path.join(out, "proof-manifest.json"), files);
  const result = await verify(path.join(out, "proof-manifest.json"), {
    codeRepo: repo,
    designRepo: repo,
    policy,
  });
  await writeFile(
    path.join(out, "verification.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
  const reviewLog = await readReview(
    path.join(repo, ".foundation/review-log.json"),
  );
  const runBody = {
    schema: "fdn-review-run/0" as const,
    run: opt("--run", process.env.GITHUB_RUN_ID ?? "local")!,
    createdAt: new Date().toISOString(),
    artifactUrl: opt("--artifact-url", ".")!,
    candidates: reports.flatMap((r: any, i: number) =>
      r.provable
        ? r.defects.map((d: any) =>
            candidateOf(r, d, path.relative(out, files[i]!)),
          )
        : [],
    ),
  };
  const reviewRun = { ...runBody, runHash: hash(runBody) };
  await writeFile(
    path.join(out, "review-index.json"),
    canonical(reviewRun) + "\n",
  );
  const reviewItems = reviewRun.candidates.map((c: any) => {
    const r = reports.find((r) => identity(r) === identity(c.scope));
    const d = r.defects.find((d: any) => d.id === c.defectId);
    return { ...c, ...reviewState(c, reviewLog, !!d.accepted) };
  });
  await writeFile(
    path.join(out, "review-status.json"),
    JSON.stringify(
      {
        run: reviewRun.run,
        reviewLogHash: hash(reviewLog),
        unreviewed: reviewItems.filter((i: any) => i.status === "unreviewed")
          .length,
        reviewed: reviewItems.filter((i: any) => i.status !== "unreviewed")
          .length,
        items: reviewItems,
        reviewTimes: reviewLog.sessions.filter((s) => s.endedAt),
      },
      null,
      2,
    ) + "\n",
  );
  const summary = jobSummary(
    reports,
    result,
    opt("--mode", "advisory")!,
    opt("--artifact-url", ".")!,
    { compareVerifyMs: Math.round(performance.now() - started) },
    policy.environmentCauses,
    { log: reviewLog, run: reviewRun },
  );
  await writeFile(path.join(out, "summary.md"), summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  if (!result.passed) {
    if (opt("--mode", "advisory") === "required") process.exitCode = 1;
    else
      console.log(
        "::warning::Design proof found drift or incomplete coverage (advisory mode)",
      );
  }
} else
  throw Error(
    "foundation-proof capture-code|check|accept|review-start|review|review-end ...",
  );
