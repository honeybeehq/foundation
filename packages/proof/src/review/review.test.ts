import { test, expect } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { hash, seal } from "../compare/canonical.ts";
import {
  candidateOf,
  emptyReview,
  reviewState,
  readReview,
  loadRun,
} from "./index.ts";
const report = () => ({
  artboard: "keycap",
  state: "default",
  viewport: { width: 100, height: 50, dpr: 1 },
  design: {
    file: "board.html",
    head: "a".repeat(64),
    htmlSha256: "b".repeat(64),
  },
  code: { root: "bits.tsx#Keycap", commit: "old" },
  provable: true,
  acceptancePixelHashes: { "def-one": "f".repeat(64) },
  drifts: [
    {
      id: "d1",
      kind: "style",
      property: "color",
      design: "red",
      code: "blue",
      designNode: "label",
      codeNode: "label",
    },
  ],
  defects: [
    {
      id: "def-one",
      layer: { design: "label", code: "label" },
      kind: "style",
      classification: "product",
      cause: "style:color",
      findings: ["d1"],
      summary: "color differs",
    },
  ],
});
function reviewed(r: any) {
  const c = candidateOf(r, r.defects[0], "report.json");
  return {
    c,
    log: {
      ...emptyReview(),
      entries: [
        {
          key: c.key,
          defectId: c.defectId,
          fingerprint: c.fingerprint,
          decision: "false" as const,
          note: "manual review",
          reviewer: "Reviewer",
          run: "10",
          at: new Date().toISOString(),
          sessionId: "session",
          reviewMs: 1000,
        },
      ],
    },
  };
}
test("unrelated commit/new finding does not ask twice; new cause is unreviewed", () => {
  const r: any = report(),
    { c, log } = reviewed(r);
  r.code.commit = "new";
  r.drifts.push({
    id: "d9",
    kind: "style",
    property: "box-shadow",
    design: "none",
    code: "1px 1px red",
  });
  const d = {
    ...r.defects[0],
    id: "def-new",
    cause: "style:surface",
    findings: ["d9"],
  };
  expect(
    reviewState(candidateOf(r, r.defects[0], "new-path/report.json"), log)
      .status,
  ).toBe("false");
  expect(reviewState(candidateOf(r, d, "report.json"), log).status).toBe(
    "unreviewed",
  );
});
test("changed measured value or design revision reopens review", () => {
  const r = report(),
    { log } = reviewed(r);
  r.drifts[0]!.code = "green";
  expect(
    reviewState(candidateOf(r, r.defects[0], "report.json"), log).status,
  ).toBe("unreviewed");
  r.design.head = "c".repeat(64);
  expect(
    reviewState(candidateOf(r, r.defects[0], "report.json"), log).stale,
  ).toBe(true);
});
test("state scope and stale intended acceptance are not carried over", () => {
  const r = report(),
    { c, log } = reviewed(r);
  r.state = "failed";
  expect(
    reviewState(candidateOf(r, r.defects[0], "report.json"), log).status,
  ).toBe("unreviewed");
  log.entries[0]!.decision = "accept" as any;
  expect(reviewState(c, log, false).status).toBe("unreviewed");
  expect(reviewState(c, log, true).status).toBe("accept");
});
test("actual CLI measures and persists a review session", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fdn-review-"));
  try {
    const r = seal(report());
    await writeFile(path.join(dir, "report.json"), JSON.stringify(r));
    const body = {
      schema: "fdn-review-run/0",
      run: "123",
      createdAt: new Date().toISOString(),
      artifactUrl: ".",
      candidates: [candidateOf(r, r.defects[0], "report.json")],
    };
    const index = path.join(dir, "review-index.json");
    await writeFile(index, JSON.stringify({ ...body, runHash: hash(body) }));
    const invoke = (...args: string[]) =>
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "packages/proof/src/review/cli.ts",
          ...args,
          "--code",
          dir,
        ],
        { encoding: "utf8" },
      );
    invoke("review-start", index, "--reviewer", "Pilot demo");
    invoke("review", index, "def-one", "real", "--note", "Visible blue text");
    const output = invoke("review-end", index);
    expect(output).toContain("1 decisions");
    const log = await readReview(path.join(dir, ".foundation/review-log.json"));
    expect(log.entries[0]!.decision).toBe("real");
    expect(log.sessions[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(reviewState(body.candidates[0]!, log).status).toBe("real");
    invoke("review-start", index, "--reviewer", "Pilot demo");
    invoke(
      "review",
      index,
      "def-one",
      "accept",
      "--note",
      "Keep this intended color",
    );
    invoke("review-end", index);
    const { readAccepted, evaluateAccepted } = await import(
      "../accept/index.ts"
    );
    const list = await readAccepted(
      path.join(dir, ".foundation/accepted.json"),
    );
    expect(evaluateAccepted(r, list).accepted).toEqual(["def-one"]);
    expect(
      reviewState(
        body.candidates[0]!,
        await readReview(path.join(dir, ".foundation/review-log.json")),
        true,
      ).status,
    ).toBe("accept");
    invoke("review-start", index, "--reviewer", "Pilot demo");
    expect(() =>
      invoke("review-start", index, "--reviewer", "Second session"),
    ).toThrow("Another review is active");
    invoke("review-abort", index, "--note", "Orphan recovery demo");
    expect(
      (
        await readReview(path.join(dir, ".foundation/review-log.json"))
      ).sessions.at(-1)!.aborted,
    ).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("tampered run index is refused", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fdn-review-"));
  try {
    const index = path.join(dir, "index.json");
    await writeFile(
      index,
      JSON.stringify({
        schema: "fdn-review-run/0",
        run: "1",
        candidates: [],
        runHash: "0".repeat(64),
      }),
    );
    await expect(loadRun(index, dir)).rejects.toThrow("hash/schema");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a valid pre-existing acceptance is already reviewed", () => {
  const r = report(),
    c = candidateOf(r, r.defects[0], "report.json");
  expect(reviewState(c, emptyReview(), true).status).toBe("accept");
});
test("review and acceptance persist together, with rollback on log failure", async () => {
  const { persistReview } = await import("./index.ts");
  const dir = await mkdtemp(path.join(tmpdir(), "fdn-review-"));
  try {
    await mkdir(path.join(dir, ".foundation"));
    const file = path.join(dir, ".foundation/accepted.json"),
      before = '{"schema":"fdn-accepted/0","entries":[]}\n';
    await writeFile(file, before);
    await mkdir(path.join(dir, ".foundation/review-log.json"));
    await expect(
      persistReview(dir, emptyReview(), {
        schema: "fdn-accepted/0",
        entries: [{ id: "example" }],
      }),
    ).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe(before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("ended-session timing must be consistent and finite", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fdn-review-"));
  try {
    const file = path.join(dir, "log.json");
    await writeFile(
      file,
      JSON.stringify({
        ...emptyReview(),
        sessions: [
          {
            id: "s",
            run: "r",
            reviewer: "p",
            startedAt: "2026-01-01T00:00:00Z",
            lastAt: "2026-01-01T00:00:01Z",
            endedAt: "2026-01-01T00:00:02Z",
            durationMs: -1,
          },
        ],
      }),
    );
    await expect(readReview(file)).rejects.toThrow("session");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("aborted-session decisions are explicitly untimed", async () => {
  const { reviewCounts, runReviewMs } = await import("./index.ts");
  const r = report(),
    { log } = reviewed(r);
  log.entries[0]!.sessionId = "aborted";
  log.sessions = [
    {
      id: "aborted",
      run: "10",
      reviewer: "Reviewer",
      startedAt: "2026-01-01T00:00:00Z",
      lastAt: "2026-01-01T00:00:01Z",
      endedAt: "2026-01-01T00:00:02Z",
      durationMs: 2000,
      aborted: true,
    },
  ];
  expect(reviewCounts(log, "10")).toEqual({ timed: 0, untimed: 1 });
  expect(runReviewMs(log, "10")).toBe(0);
});
