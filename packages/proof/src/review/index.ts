import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { hash, canonical, checkHash } from "../compare/canonical.ts";
import {
  defectsOf,
  valuesOf,
  scopeOf,
  makeAcceptance,
  readAccepted,
} from "../accept/index.ts";
export type Decision = "real" | "accept" | "false";
export interface Candidate {
  key: string;
  defectId: string;
  scope: ReturnType<typeof scopeOf>;
  fingerprint: string;
  report: string;
  summary: string;
  classification: string;
}
export interface ReviewRun {
  schema: "fdn-review-run/0";
  run: string;
  createdAt: string;
  artifactUrl: string;
  candidates: Candidate[];
  runHash?: string;
}
export interface ReviewEntry {
  key: string;
  defectId: string;
  fingerprint: string;
  decision: Decision;
  note: string;
  reviewer: string;
  run: string;
  at: string;
  sessionId: string;
  reviewMs: number;
}
export interface ReviewSession {
  id: string;
  run: string;
  reviewer: string;
  startedAt: string;
  lastAt: string;
  endedAt?: string;
  durationMs?: number;
}
export interface ReviewLog {
  schema: "fdn-review-log/0";
  entries: ReviewEntry[];
  sessions: ReviewSession[];
}
export const emptyReview = (): ReviewLog => ({
  schema: "fdn-review-log/0",
  entries: [],
  sessions: [],
});
export async function readReview(file: string): Promise<ReviewLog> {
  let value: any;
  try {
    value = JSON.parse(await readFile(file, "utf8"));
  } catch (e: any) {
    if (e.code === "ENOENT") return emptyReview();
    throw e;
  }
  if (
    value?.schema !== "fdn-review-log/0" ||
    !Array.isArray(value.entries) ||
    !Array.isArray(value.sessions)
  )
    throw Error("Expected fdn-review-log/0 entries and sessions");
  for (const e of value.entries)
    if (
      !e ||
      !["real", "accept", "false"].includes(e.decision) ||
      ![
        e.key,
        e.defectId,
        e.fingerprint,
        e.note,
        e.reviewer,
        e.run,
        e.at,
        e.sessionId,
      ].every((x) => typeof x === "string" && x.trim()) ||
      !Number.isFinite(e.reviewMs) ||
      e.reviewMs < 0
    )
      throw Error("Invalid review entry");
  for (const s of value.sessions)
    if (
      !s ||
      ![s.id, s.run, s.reviewer, s.startedAt, s.lastAt].every(
        (x) => typeof x === "string" && x.trim(),
      ) ||
      !Number.isFinite(Date.parse(s.startedAt)) ||
      !Number.isFinite(Date.parse(s.lastAt))
    )
      throw Error("Invalid review session");
  return value;
}
export async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = file + ".tmp";
  await writeFile(temp, canonical(value) + "\n");
  await rename(temp, file);
}
export const candidateKey = (r: any, id: string) =>
  `${r.artboard}/${r.state}/${r.viewport.width}x${r.viewport.height}@${r.viewport.dpr}::${id}`;
/** Bind the measured claim, not the code commit or unrelated pixels/properties. Acceptance separately pins pixels. */
export function candidateOf(r: any, d: any, report: string): Candidate {
  return {
    key: candidateKey(r, d.id),
    defectId: d.id,
    scope: scopeOf(r),
    fingerprint: hash({
      scope: scopeOf(r),
      design: r.design,
      component: r.code.root,
      layer: d.layer,
      kind: d.kind,
      cause: d.cause,
      classification: d.classification,
      values: valuesOf(r, d),
    }),
    report,
    summary: d.summary,
    classification: d.classification,
  };
}
export function reviewState(
  candidate: Candidate,
  log: ReviewLog,
  accepted: boolean = false,
) {
  const prior = [...log.entries].reverse().find((e) => e.key === candidate.key);
  if (!prior) return { status: "unreviewed" as const, entry: null };
  if (
    prior.fingerprint !== candidate.fingerprint ||
    (prior.decision === "accept" && !accepted)
  )
    return { status: "unreviewed" as const, entry: prior, stale: true };
  return { status: prior.decision, entry: prior };
}
export function runReviewMs(log: ReviewLog, run: string) {
  return log.sessions
    .filter((s) => s.run === run && s.endedAt)
    .reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
}
export async function loadRun(ref: string, repo: string) {
  const file = path.resolve(
    ref.endsWith(".json")
      ? ref
      : path.join(repo, ".foundation/review-runs", ref, "review-index.json"),
  );
  const run = JSON.parse(await readFile(file, "utf8")) as ReviewRun;
  const { runHash, ...body } = run;
  if (
    run.schema !== "fdn-review-run/0" ||
    !Array.isArray(run.candidates) ||
    hash(body) !== runHash
  )
    throw Error("Review run index hash/schema mismatch");
  return { file, run };
}
export async function recordReview(
  run: ReviewRun,
  candidate: Candidate,
  decision: Decision,
  note: string,
  repo: string,
  indexFile: string,
  log: ReviewLog,
  now = new Date(),
) {
  if (!note.trim()) throw Error("A review note is required");
  const session = [...log.sessions]
    .reverse()
    .find((s) => s.run === run.run && !s.endedAt);
  if (!session)
    throw Error(
      "Start measured review with review-start RUN --reviewer NAME first",
    );
  const report = JSON.parse(
    await readFile(
      path.resolve(path.dirname(indexFile), candidate.report),
      "utf8",
    ),
  );
  if (!checkHash(report)) throw Error("Report hash mismatch");
  const defect = defectsOf(report).find((d) => d.id === candidate.defectId);
  if (
    !defect ||
    candidateOf(report, defect, candidate.report).fingerprint !==
      candidate.fingerprint
  )
    throw Error("Review index differs from measured report");
  if (decision === "accept") {
    const list = await readAccepted(
        path.join(repo, ".foundation/accepted.json"),
      ),
      entry = makeAcceptance(
        report,
        candidate.defectId,
        note,
        session.reviewer,
      );
    list.entries = list.entries.filter(
      (e) =>
        !(e.id === entry.id && canonical(e.scope) === canonical(entry.scope)),
    );
    list.entries.push(entry);
    await writeJson(path.join(repo, ".foundation/accepted.json"), list);
  }
  const entry: ReviewEntry = {
    key: candidate.key,
    defectId: candidate.defectId,
    fingerprint: candidate.fingerprint,
    decision,
    note,
    reviewer: session.reviewer,
    run: run.run,
    at: now.toISOString(),
    sessionId: session.id,
    reviewMs: Math.max(0, now.getTime() - Date.parse(session.lastAt)),
  };
  log.entries.push(entry);
  session.lastAt = entry.at;
  return entry;
}
