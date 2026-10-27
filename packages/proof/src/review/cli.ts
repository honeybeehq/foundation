import path from "node:path";
import { hash } from "../compare/canonical.ts";
import {
  loadRun,
  readReview,
  writeJson,
  recordReview,
  runReviewMs,
  type Decision,
} from "./index.ts";
const [command, ref, id, decision, ...rest] = process.argv.slice(2);
const args = process.argv.slice(2),
  opt = (k: string, f?: string) =>
    args.includes(k) ? args[args.indexOf(k) + 1] : f;
const repo = path.resolve(opt("--code", ".")!),
  file = path.join(repo, ".foundation/review-log.json");
if (!ref)
  throw Error(
    "review-start RUN --reviewer NAME | review RUN DEFECT_ID real|accept|false --note NOTE | review-end RUN",
  );
const { file: indexFile, run } = await loadRun(ref, repo),
  log = await readReview(file),
  now = new Date().toISOString();
if (command === "review-start") {
  const reviewer = opt("--reviewer");
  if (!reviewer?.trim()) throw Error("--reviewer is required");
  if (log.sessions.some((s) => s.run === run.run && !s.endedAt))
    throw Error("Review already started; finish it with review-end RUN");
  log.sessions.push({
    id: hash({ run: run.run, now, reviewer }).slice(0, 20),
    run: run.run,
    reviewer,
    startedAt: now,
    lastAt: now,
  });
  console.log(
    `Started measured review of ${run.run}; inspect candidates/images, then review each item.`,
  );
} else if (command === "review-end") {
  const s = [...log.sessions]
    .reverse()
    .find((s) => s.run === run.run && !s.endedAt);
  if (!s) throw Error("No active review session");
  s.endedAt = now;
  s.durationMs = Date.parse(now) - Date.parse(s.startedAt);
  console.log(
    `Review ${run.run}: ${runReviewMs(log, run.run)} ms wall time; ${log.entries.filter((e) => e.sessionId === s.id).length} decisions in this session.`,
  );
} else if (command === "review") {
  if (!id || !["real", "accept", "false"].includes(decision ?? ""))
    throw Error("review RUN DEFECT_ID real|accept|false --note NOTE");
  const candidates = run.candidates.filter(
    (c) => c.key === id || c.defectId === id,
  );
  if (candidates.length !== 1)
    throw Error(
      `Expected one candidate; found ${candidates.length}. Use the scoped id printed in the summary.`,
    );
  const e = await recordReview(
    run,
    candidates[0]!,
    decision as Decision,
    opt("--note", "")!,
    repo,
    indexFile,
    log,
  );
  console.log(
    `${e.key}: ${e.decision}; measured ${e.reviewMs} ms since prior review action.`,
  );
} else throw Error("Unknown review command");
await writeJson(file, log);
