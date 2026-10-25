import { describe, it, expect } from "vitest";
import { matchNodes } from "./match.ts";
import { groupDefects } from "./defects.ts";
import type { CaptureNode, Capture, Drift } from "./types.ts";
const node = (path: string, extra: Partial<CaptureNode> = {}): CaptureNode => ({ path, tag: "div", box: [0,0,100,100], style: { display: "flex" }, ...extra });
const cap = (nodes: CaptureNode[]): Capture => ({ nodes, meta: {}, screenshot: Buffer.alloc(0) });
describe("correspondence regressions", () => {
  it("represents transparent duplicate wrappers without extra product nodes", () => {
    const result = matchNodes([node("0", { text: "Hello" })], [node("0"),node("0/0",{text:"Hello"})]);
    expect(result.matches).toHaveLength(1);
    expect(result.extra).toHaveLength(0);
    expect(result.matches[0]?.wrappers?.code).toEqual(["0"]);
  });
  it("does not identify unrelated icon primitives by their overlapping box", () => {
    const result = matchNodes([node("0",{tag:"svg"}),node("0/0",{tag:"circle"})], [node("0",{tag:"svg"}),node("0/0",{tag:"path"})]);
    expect(result.matches).toHaveLength(0);
  });
});
describe("causal grouping", () => {
  it("counts a missing subtree once and preserves every raw finding", () => {
    const ds = [node("0"),node("0/0"),node("0/0/0")];
    const drifts: Drift[] = ds.map((n,i) => ({id:`d${i}`,kind:"missing",designNode:n.path,confidence:0,property:"node"}));
    const defects = groupDefects(drifts,[],cap(ds),cap([]));
    expect(defects).toHaveLength(1);
    expect(defects[0]?.findings).toEqual(["d0","d1","d2"]);
  });
});
