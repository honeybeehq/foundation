import { test, expect } from "vitest";
import { PNG } from "pngjs";
import {
  makeAcceptance,
  emptyList,
  bindAccepted,
  evaluateAccepted,
  parseList,
  hasUnacceptedDrift,
} from "./index.ts";
const report = () => ({
  provable: true,
  acceptancePixelHashes: { f1: "f".repeat(64) },
  code: { root: "component.tsx#View" },
  artboard: "tracks",
  state: "empty",
  viewport: { width: 100, height: 100, dpr: 1 },
  design: { htmlSha256: "a".repeat(64), head: "b".repeat(64) },
  drifts: [
    {
      id: "d1",
      kind: "text",
      property: "text",
      designNode: "title",
      codeNode: "title",
      design: "Create track",
      code: "New track",
    },
  ],
  defects: [
    {
      id: "f1",
      layer: { design: "title", code: "title" },
      kind: "text",
      cause: "text",
      classification: "product",
      findings: ["d1"],
      summary: "button label",
    },
  ],
  pixels: { diffRatio: 0.1 },
  tolerances: { pixelRatio: 0.001 },
});
const accepted = () => ({
  schema: "fdn-accepted/0" as const,
  entries: [
    makeAcceptance(
      report(),
      "f1",
      "Keep the existing Classic label",
      "Reviewer",
    ),
  ],
});
test("acceptance records reviewer, exact values and design revision in hashed proof", () => {
  const r = bindAccepted(report(), accepted());
  expect(r.defects[0].accepted.reason).toContain("Classic");
  expect(evaluateAccepted(r, accepted()).accepted).toEqual(["f1"]);
  expect(r.acceptedListHash).toHaveLength(64);
  expect(hasUnacceptedDrift(r, accepted(), 0)).toBe(false);
});
test("changed design is stale with actionable message", () => {
  const r = report();
  r.design.head = "c".repeat(64);
  expect(evaluateAccepted(r, accepted()).errors[0]).toContain(
    "design changed since this difference was accepted; re-review or update the design",
  );
});
test("changed code value is stale", () => {
  const r = report();
  r.drifts[0]!.code = "Make track";
  expect(evaluateAccepted(r, accepted()).errors[0]).toContain(
    "code or measured value changed",
  );
});
test("raw finding sequence changes do not invalidate acceptance", () => {
  const r = report();
  r.drifts[0]!.id = "d9";
  r.defects[0]!.findings = ["d9"];
  expect(evaluateAccepted(r, accepted()).errors).toEqual([]);
});
test("unknown entry fails instead of silently disappearing", () => {
  const r = report();
  r.defects = [];
  expect(evaluateAccepted(r, accepted()).errors[0]).toContain(
    "unknown accepted difference",
  );
});
test("acceptance cannot cross state scope", () => {
  const r = report();
  r.state = "selected";
  expect(evaluateAccepted(r, accepted()).accepted).toEqual([]);
  expect(hasUnacceptedDrift(r, accepted(), 0)).toBe(true);
});
test("environment and uncertain findings cannot be accepted", () => {
  for (const classification of ["environment", "uncertain"]) {
    const r = report();
    r.defects[0]!.classification = classification;
    expect(() => makeAcceptance(r, "f1", "reason", "reviewer")).toThrow(
      "Only product",
    );
  }
});
test("invalid metadata and duplicate entries fail", () => {
  const l = accepted();
  l.entries.push(l.entries[0]!);
  expect(() => parseList(l)).toThrow("Duplicate");
  expect(() => makeAcceptance(report(), "f1", "", "")).toThrow();
  expect(hasUnacceptedDrift(report(), emptyList())).toBe(true);
});

test("accepted text never waives unrelated pixel drift", async () => {
  const { PNG } = await import("pngjs");
  const { residualPixels } = await import("./index.ts");
  const a = new PNG({ width: 100, height: 100 });
  a.data.fill(255);
  const b = PNG.sync.read(PNG.sync.write(a));
  // One accepted glyph-sized change, then a separate image/canvas pixel.
  b.data[0] = 0;
  b.data[1] = 0;
  b.data[2] = 0;
  const r: any = report();
  r.drifts[0].designBox = [0, 0, 20, 20];
  r.drifts[0].codeBox = [0, 0, 20, 20];
  r.tolerances.pixelThreshold = 0.1;
  r.tolerances.pixelRatio = 0;
  const list = {
    schema: "fdn-accepted/0" as const,
    entries: [makeAcceptance(r, "f1", "Keep text", "Reviewer")],
  };
  const capture = (png: any) => ({
    nodes: [],
    meta: {},
    screenshot: PNG.sync.write(png),
  });
  let pixels = residualPixels(r, list, {
    design: capture(a),
    code: capture(b),
  });
  expect(pixels.residualPixels).toBe(0);
  const offset = (80 * 100 + 80) * 4;
  b.data[offset] = 0;
  b.data[offset + 1] = 0;
  b.data[offset + 2] = 0;
  pixels = residualPixels(r, list, { design: capture(a), code: capture(b) });
  expect(pixels.residualPixels).toBe(1);
  expect(hasUnacceptedDrift(r, list, pixels.residualRatio)).toBe(true);
  expect(hasUnacceptedDrift(r, list)).toBe(true);
});
test("same-box extra subtree content change makes acceptance stale", async () => {
  const { withAcceptanceInputs } = await import("./index.ts");
  const r: any = report();
  r.drifts = [
    {
      id: "d1",
      kind: "extra",
      codeNode: "extra",
      property: "node",
      codeBox: [0, 0, 20, 20],
    },
  ];
  r.defects = [
    {
      id: "f1",
      layer: { code: "extra" },
      kind: "extra",
      cause: "extra:subtree",
      classification: "product",
      findings: ["d1"],
    },
  ];
  const n = {
    path: "div[0]",
    fdnId: "extra",
    tag: "div",
    box: [0, 0, 20, 20] as [number, number, number, number],
    style: { color: "red" },
  };
  const child = {
    ...n,
    path: "div[0]/span[0]",
    fdnId: "child",
    tag: "span",
    text: "Before",
  };
  const design = {
      nodes: [],
      meta: {},
      screenshot: (() => {
        const p = new PNG({ width: 100, height: 100 });
        p.data.fill(255);
        return PNG.sync.write(p);
      })(),
    },
    code = {
      nodes: [n, child],
      meta: {},
      screenshot: (() => {
        const p = new PNG({ width: 100, height: 100 });
        p.data.fill(255);
        return PNG.sync.write(p);
      })(),
    };
  expect(() => makeAcceptance(r, "f1", "Keep subtree", "Reviewer")).toThrow(
    "without captured contents",
  );
  const initial = withAcceptanceInputs(r, { design, code }),
    list = {
      schema: "fdn-accepted/0" as const,
      entries: [makeAcceptance(initial, "f1", "Keep subtree", "Reviewer")],
    };
  child.text = "After";
  const changed = withAcceptanceInputs(r, { design, code });
  expect(evaluateAccepted(changed, list).errors[0]).toContain(
    "code or measured value changed",
  );
});
test("environment classification requires a trusted cause allowlist", () => {
  const r: any = report();
  r.defects[0].classification = "environment";
  r.defects[0].cause = "declared-linux-font-substitution";
  r.pixels.diffRatio = 0;
  expect(hasUnacceptedDrift(r, emptyList())).toBe(true);
  expect(
    hasUnacceptedDrift(r, emptyList(), undefined, [
      "declared-linux-font-substitution",
    ]),
  ).toBe(false);
});
test("a different linked component invalidates acceptance", () => {
  const r = report();
  r.code.root = "different.tsx#View";
  expect(evaluateAccepted(r, accepted()).errors[0]).toContain(
    "code or measured value changed",
  );
});

test("invisible DOM pixel changes inside accepted bounds make acceptance stale", async () => {
  const { withAcceptanceInputs } = await import("./index.ts");
  const r: any = report();
  r.drifts[0].designBox = [0, 0, 20, 20];
  r.drifts[0].codeBox = [0, 0, 20, 20];
  const image = new PNG({ width: 100, height: 100 });
  image.data.fill(255);
  const capture = () => ({
    nodes: [],
    meta: {},
    screenshot: PNG.sync.write(image),
  });
  const design = capture(),
    before = withAcceptanceInputs(r, { design, code: capture() });
  const list = {
    schema: "fdn-accepted/0" as const,
    entries: [makeAcceptance(before, "f1", "Keep text", "Reviewer")],
  };
  image.data[0] = 0;
  const after = withAcceptanceInputs(r, { design, code: capture() });
  expect(after.drifts).toEqual(before.drifts);
  expect(evaluateAccepted(after, list).errors[0]).toContain(
    "code or measured value changed",
  );
});
