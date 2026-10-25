import { hash, canonical } from "./canonical.ts";
import type { Capture, CaptureNode, Defect, Drift, Match } from "./types.ts";

const identity = (n: CaptureNode) => n.fdnId || n.path;
const inside = (child: CaptureNode, parent: CaptureNode) =>
  child.path.startsWith(parent.path + "/");
const inherited =
  /^(font-|color$|line-height$|letter-spacing$|text-align$|white-space$)/;
const layoutProperty =
  /^(padding-|margin-|border-.*-width$|gap$|row-gap$|column-gap$|display$|position$|box-sizing$|overflow-|flex-|align-|justify-)/;
const family = (p: string) =>
  /^padding-/.test(p)
    ? "padding"
    : /^margin-/.test(p)
      ? "margin"
      : /^border-.*-radius$/.test(p)
        ? "border-radius"
        : /^border-/.test(p)
          ? "border"
          : p;

/** Conservative causal groups over captured facts; raw measurements are never deleted. */
export function groupDefects(
  drifts: Drift[],
  matches: Match[],
  design: Capture,
  code: Capture,
): Defect[] {
  const dn = new Map(design.nodes.map((n) => [identity(n), n]));
  const cn = new Map(code.nodes.map((n) => [identity(n), n]));
  const pairs = new Map(matches.map((m) => [identity(m.design), m]));
  const groups = new Map<string, Defect>();
  for (const d of drifts) {
    let a = d.designNode ? dn.get(d.designNode) : undefined;
    let b = d.codeNode ? cn.get(d.codeNode) : undefined;
    let layer: Defect["layer"] = {
      ...(d.designNode ? { design: d.designNode } : {}),
      ...(d.codeNode ? { code: d.codeNode } : {}),
    };
    let cause = `${d.kind}:${family(d.property)}`;
    let classification: Defect["classification"] = pairs.get(d.designNode ?? "")
      ?.uncertain
      ? "uncertain"
      : "product";
    if (
      d.property === "font-family" &&
      design.meta.fontPolicy?.requireCustomFonts === true &&
      code.meta.fontPolicy?.requireCustomFonts === true &&
      /(?:-apple-system|Helvetica|SF Mono|Menlo|ui-monospace)/i.test(
        String(d.design),
      ) &&
      /(?:sans-serif|monospace)/i.test(String(d.code))
    ) {
      classification = "environment";
      cause = "declared-linux-font-substitution";
    }
    if (a && b && inherited.test(d.property)) {
      // Find the highest pair carrying exactly the same computed inherited values.
      const ancestors = matches
        .filter(
          (m) =>
            !m.uncertain &&
            inside(a!, m.design) &&
            inside(b!, m.code) &&
            m.design.style[d.property] === a!.style[d.property] &&
            m.code.style[d.property] === b!.style[d.property],
        )
        .sort((x, y) => x.design.path.length - y.design.path.length);
      const root = ancestors[0];
      if (root)
        layer = { design: identity(root.design), code: identity(root.code) };
    }
    if (d.kind === "missing" || d.kind === "extra") {
      const node = a ?? b;
      const tree = d.kind === "missing" ? dn : cn;
      const key = d.kind === "missing" ? "designNode" : "codeNode";
      const ancestors = drifts
        .filter(
          (x) =>
            x.kind === d.kind &&
            x[key] &&
            node &&
            tree.get(x[key]!) &&
            inside(node, tree.get(x[key]!)!),
        )
        .sort(
          (x, y) =>
            tree.get(x[key]!)!.path.length - tree.get(y[key]!)!.path.length,
        );
      const root = ancestors[0] ?? d;
      layer = {
        ...(root.designNode ? { design: root.designNode } : {}),
        ...(root.codeNode ? { code: root.codeNode } : {}),
      };
      cause = `${d.kind}:subtree`;
    }
    if (d.kind === "layout" && a && b) {
      const delta = Number(d.code) - Number(d.design);
      const candidates = drifts
        .filter(
          (x) =>
            x.kind === "layout" &&
            x.property === d.property &&
            Math.abs(Number(x.code) - Number(x.design) - delta) < 0.05 &&
            x.designNode &&
            x.codeNode &&
            dn.get(x.designNode) &&
            cn.get(x.codeNode) &&
            inside(a!, dn.get(x.designNode)!) &&
            inside(b!, cn.get(x.codeNode)!),
        )
        .sort(
          (x, y) =>
            dn.get(x.designNode!)!.path.length -
            dn.get(y.designNode!)!.path.length,
        );
      const root = candidates[0];
      if (root) {
        layer = { design: root.designNode!, code: root.codeNode! };
        cause = `layout:${root.property}`;
      }
      // x/y consequences of an ancestor padding change are one size/layout cause.
      const padding = drifts.find(
        (x) =>
          /^padding-/.test(x.property) &&
          (d.property === "x"
            ? x.property.endsWith("left")
            : d.property === "y"
              ? x.property.endsWith("top")
              : false) &&
          x.designNode &&
          x.codeNode &&
          dn.get(x.designNode) &&
          cn.get(x.codeNode) &&
          inside(a!, dn.get(x.designNode)!) &&
          inside(b!, cn.get(x.codeNode)!) &&
          Math.abs(
            parseFloat(String(x.code)) - parseFloat(String(x.design)) - delta,
          ) < 0.05,
      );
      if (padding) {
        layer = { design: padding.designNode!, code: padding.codeNode! };
        cause = `${padding.kind}:padding`;
      }
    }
    // Geometry and its layout configuration form one candidate cause at a layer.
    // This does not assert a particular CSS declaration caused the discrepancy.
    if (
      classification === "product" &&
      (d.kind === "layout" || layoutProperty.test(d.property))
    ) {
      cause = "layout:configuration";
    }
    const kind =
      cause === "layout:configuration"
        ? "layout"
        : cause.includes(":padding")
          ? (drifts.find(
              (x) =>
                x.designNode === layer.design && /^padding-/.test(x.property),
            )?.kind ?? d.kind)
          : d.kind;
    if (classification === "environment") {
      // Substitution is one declared capture-wide policy, not one defect per label.
      layer = {
        design: identity(design.nodes[0]!),
        code: identity(code.nodes[0]!),
      };
    }
    const key = canonical({ layer, kind, cause, classification });
    let group = groups.get(key);
    if (!group) {
      group = {
        id: "def-" + hash({ layer, kind, cause }).slice(0, 20),
        layer,
        kind,
        cause,
        classification,
        findings: [],
        summary:
          classification === "environment"
            ? "Font family differs under the declared Linux substitution"
            : `${cause.replace(":", " ")} differs at ${layer.design ?? layer.code}`,
      };
      groups.set(key, group);
    }
    group.findings.push(d.id);
  }
  return [...groups.values()];
}
