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
    const result = matchNodes([node("0/0"),node("0/0/0",{text:"unique title"}),node("0/0/1",{text:"old metadata"})], [node("0/1",{box:[200,0,100,100]}),node("0/1/0",{text:"unique title",box:[200,0,100,100]}),node("0/1/1",{text:"new metadata",box:[200,0,100,100]})]);
    expect(result.matches.some(m=>m.design.path==="0/0"&&m.code.path==="0/1")).toBe(true);
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
