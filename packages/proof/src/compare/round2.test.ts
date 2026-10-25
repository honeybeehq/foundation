import { describe, it, expect } from "vitest";
import { matchNodes } from "./match.ts";
import { groupDefects } from "./defects.ts";
import type { CaptureNode, Capture, Drift } from "./types.ts";
const node = (path: string, extra: Partial<CaptureNode> = {}): CaptureNode => ({
  path,
  tag: "div",
  box: [0, 0, 100, 100],
  style: { display: "flex" },
  ...extra,
});
const cap = (nodes: CaptureNode[]): Capture => ({
  nodes,
  meta: {},
  screenshot: Buffer.alloc(0),
});
describe("correspondence regressions", () => {
  it("represents transparent duplicate wrappers without extra product nodes", () => {
    const result = matchNodes(
      [node("0", { text: "Hello" })],
      [node("0"), node("0/0", { text: "Hello" })],
    );
    expect(result.matches).toHaveLength(1);
    expect(result.extra).toHaveLength(0);
    expect(result.matches[0]?.wrappers?.code).toEqual(["0"]);
  });
  it("allows an extra transparent layout wrapper around already matched content", () => {
    const result = matchNodes(
      [node("0", { text: "Hello" })],
      [node("0", { box: [0, 0, 120, 120] }), node("0/0", { text: "Hello" })],
    );
    expect(result.extra).toHaveLength(0);
    expect(result.matches[0]?.wrappers?.code).toEqual(["0"]);
  });
  it("uses unique descendant text to identify a relocated row with different metadata", () => {
    const result = matchNodes(
      [
        node("0/0"),
        node("0/0/0", { text: "unique title" }),
        node("0/0/1", { text: "old metadata" }),
      ],
      [
        node("0/1", { box: [200, 0, 100, 100] }),
        node("0/1/0", { text: "unique title", box: [200, 0, 100, 100] }),
        node("0/1/1", { text: "new metadata", box: [200, 0, 100, 100] }),
      ],
    );
    expect(
      result.matches.some(
        (m) => m.design.path === "0/0" && m.code.path === "0/1",
      ),
    ).toBe(true);
  });
  it("uses reserved descendant identity to infer uncertain wrapper correspondence", () => {
    const design = [
      node("0/0"),
      node("0/0/0", { fdnId: "title", text: "Repeated" }),
      node("0/0/1", { text: "old metadata" }),
      node("0/4", { fdnId: "other", text: "Repeated" }),
    ];
    const code = [
      node("0/1", { box: [200, 0, 100, 100] }),
      node("0/1/0", {
        fdnId: "title",
        text: "Repeated",
        box: [200, 0, 100, 100],
      }),
      node("0/1/1", { text: "new metadata", box: [200, 0, 100, 100] }),
      node("0/5", { fdnId: "other", text: "Repeated" }),
    ];
    const result = matchNodes(design, code);
    expect(
      result.matches.find(
        (m) => m.design.path === "0/0" && m.code.path === "0/1",
      )?.uncertain,
    ).toBe(true);
  });
  it("does not identify unrelated icon primitives by their overlapping box", () => {
    const result = matchNodes(
      [node("0", { tag: "svg" }), node("0/0", { tag: "circle" })],
      [node("0", { tag: "svg" }), node("0/0", { tag: "path" })],
    );
    expect(result.matches).toHaveLength(0);
  });
});
describe("causal grouping", () => {
  it("groups layout settings with the geometry they produce", () => {
    const a = node("0", {
        fdnId: "root",
        style: { display: "flex", "padding-left": "10px" },
      }),
      b = node("0", {
        fdnId: "root",
        style: { display: "flex", "padding-left": "20px" },
      });
    const raw: Drift[] = [
      {
        id: "d1",
        kind: "layout",
        designNode: "root",
        codeNode: "root",
        property: "width",
        design: 100,
        code: 120,
        confidence: 1,
      },
      {
        id: "d2",
        kind: "style",
        designNode: "root",
        codeNode: "root",
        property: "padding-left",
        design: "10px",
        code: "20px",
        confidence: 1,
      },
    ];
    const defects = groupDefects(
      raw,
      [{ design: a, code: b, kind: "id", confidence: 1 }],
      cap([a]),
      cap([b]),
    );
    expect(defects).toHaveLength(1);
    expect(defects[0]?.findings).toEqual(["d1", "d2"]);
  });
  it("reports a structurally replaced region once and keeps its environment findings separate", () => {
    const a = node("0/0"),
      b = node("0/0"),
      at = node("0/0/0", { text: "First" }),
      bt = node("0/0/0", { text: "First" }),
      au = node("0/0/1", { text: "Second" }),
      bu = node("0/0/1", { text: "Second" });
    const old = node("0/0/2", { text: "old panel" }),
      fresh = node("0/0/2", { text: "new graph" });
    bt.style.position = bu.style.position = fresh.style.position = "absolute";
    const shell = node("0");
    const raw: Drift[] = [
      {
        id: "d1",
        kind: "missing",
        designNode: old.path,
        property: "node",
        confidence: 0,
      },
      {
        id: "d2",
        kind: "extra",
        codeNode: fresh.path,
        property: "node",
        confidence: 0,
      },
      {
        id: "d3",
        kind: "layout",
        designNode: at.path,
        codeNode: bt.path,
        property: "x",
        design: 10,
        code: 20,
        confidence: 1,
      },
    ];
    const pairs = [
      { design: shell, code: shell, kind: "id" as const, confidence: 1 },
      {
        design: a,
        code: b,
        kind: "heuristic" as const,
        confidence: 0.7,
        uncertain: true as const,
        reason: "different structure",
      },
      { design: at, code: bt, kind: "heuristic" as const, confidence: 1 },
      { design: au, code: bu, kind: "heuristic" as const, confidence: 1 },
    ];
    const defects = groupDefects(
      raw,
      pairs,
      cap([shell, a, at, au, old]),
      cap([shell, b, bt, bu, fresh]),
    );
    expect(defects).toHaveLength(1);
    expect(defects[0]?.cause).toBe("layout:region-structure");
    expect(defects[0]?.classification).toBe("product");
    expect(defects[0]?.findings).toEqual(["d1", "d2", "d3"]);
  });
  it("folds a following sibling shift into the size change that explains it", () => {
    const a = node("0/0", { box: [0, 0, 50, 100] }),
      b = node("0/0", { box: [0, 0, 70, 100] }),
      c = node("0/1", { box: [50, 0, 100, 100] }),
      d = node("0/1", { box: [70, 0, 100, 100] });
    const raw: Drift[] = [
      {
        id: "size",
        kind: "layout",
        designNode: a.path,
        codeNode: b.path,
        property: "width",
        design: 50,
        code: 70,
        confidence: 1,
      },
      {
        id: "shift",
        kind: "layout",
        designNode: c.path,
        codeNode: d.path,
        property: "x",
        design: 50,
        code: 70,
        confidence: 1,
      },
    ];
    expect(
      groupDefects(
        raw,
        [
          { design: a, code: b, kind: "id", confidence: 1 },
          { design: c, code: d, kind: "id", confidence: 1 },
        ],
        cap([a, c]),
        cap([b, d]),
      ),
    ).toHaveLength(1);
  });
  it("counts a missing subtree once and preserves every raw finding", () => {
    const ds = [node("0"), node("0/0"), node("0/0/0")];
    const drifts: Drift[] = ds.map((n, i) => ({
      id: `d${i}`,
      kind: "missing",
      designNode: n.path,
      confidence: 0,
      property: "node",
    }));
    const defects = groupDefects(drifts, [], cap(ds), cap([]));
    expect(defects).toHaveLength(1);
    expect(defects[0]?.findings).toEqual(["d0", "d1", "d2"]);
  });
});
