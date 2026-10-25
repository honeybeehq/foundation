import { hash, canonical } from "./canonical.ts";
import type { Capture, CaptureNode, Defect, Drift, Match } from "./types.ts";

const identity = (n: CaptureNode) => n.fdnId || n.path;
const inside = (child: CaptureNode, parent: CaptureNode) =>
  child.path.startsWith(parent.path + "/");
const inherited =
  /^(font-|color$|line-height$|letter-spacing$|text-align$|white-space$)/;
const layoutProperty =
  /^(padding-|margin-|border-.*-width$|gap$|row-gap$|column-gap$|line-height$|display$|position$|box-sizing$|overflow-|flex-|align-|justify-)/;
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
  const record = (
    layer: Defect["layer"],
    kind: Defect["kind"],
    cause: string,
    classification: Defect["classification"],
    finding: string,
  ) => {
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
    group.findings.push(finding);
  };
  // Uncertain leaf correspondence inside a changed region is not N proven
  // independent defects. Shared matched text anchors locate the region; two
  // distinct anchors support a product region discrepancy, one only uncertainty.
  const within = (n: CaptureNode | undefined, root: CaptureNode) =>
    !!n && (n === root || inside(n, root));
  const regionAnchors = (m: Match) =>
    new Set(
      matches
        .filter(
          (x) =>
            x !== m &&
            !x.uncertain &&
            x.design.text?.trim() &&
            x.design.text.trim() === x.code.text?.trim() &&
            /[a-z]/i.test(x.design.text) &&
            within(x.design, m.design) &&
            within(x.code, m.code),
        )
        .map((x) => x.design.text!.trim()),
    );
  const replacedLayout = (m: Match) => {
    const absolute = (nodes: CaptureNode[], root: CaptureNode) =>
      nodes.filter((n) => inside(n, root) && n.style.position === "absolute")
        .length;
    return (
      Math.abs(
        absolute(design.nodes, m.design) - absolute(code.nodes, m.code),
      ) >= 3
    );
  };
  const regions = matches
    .filter((m) => {
      if (!m.uncertain || m.design.text?.trim() || m.code.text?.trim())
        return false;
      // Never let an ungrounded broad root swallow the pane. The enclosing pair
      // must agree on both trees, and the proposed region cannot span unlike scales.
      if (
        !matches.some(
          (parent) =>
            !parent.uncertain &&
            inside(m.design, parent.design) &&
            inside(m.code, parent.code),
        )
      )
        return false;
      if (
        [2, 3].some(
          (i) =>
            Math.max(m.design.box[i]!, m.code.box[i]!) /
              Math.max(1, Math.min(m.design.box[i]!, m.code.box[i]!)) >
            4,
        )
      )
        return false;
      const anchors = regionAnchors(m);
      const absent = drifts.filter(
        (d) =>
          (d.kind === "missing" &&
            within(dn.get(d.designNode ?? ""), m.design)) ||
          (d.kind === "extra" && within(cn.get(d.codeNode ?? ""), m.code)),
      );
      return (
        absent.length >= 2 &&
        (anchors.size === 1 || (anchors.size >= 2 && replacedLayout(m)))
      );
    })
    .filter(
      (m, _, all) =>
        !all.some(
          (child) =>
            child !== m &&
            inside(child.design, m.design) &&
            inside(child.code, m.code) &&
            regionAnchors(child).size / regionAnchors(m).size >= 0.75,
        ),
    )
    .sort((a, b) => a.design.path.length - b.design.path.length);
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
    const region =
      classification !== "environment" &&
      regions.find(
        (m) =>
          (a ? within(a, m.design) : true) &&
          (b ? within(b, m.code) : true) &&
          !!(a || b),
      );
    if (region) {
      const anchors = new Set(
        matches
          .filter(
            (x) =>
              !x.uncertain &&
              x.design.text?.trim() &&
              x.design.text.trim() === x.code.text?.trim() &&
              within(x.design, region.design) &&
              within(x.code, region.code),
          )
          .map((x) => x.design.text!.trim()),
      );
      record(
        { design: identity(region.design), code: identity(region.code) },
        "layout",
        "layout:region-structure",
        anchors.size >= 2 && replacedLayout(region) ? "product" : "uncertain",
        d.id,
      );
      continue;
    }
    // These computed forms cannot establish an independent visible alignment bug
    // without captured direction. Preserve the evidence as uncertainty.
    if (
      d.property === "text-align" &&
      ["start", "left"].includes(String(d.design)) &&
      ["start", "left"].includes(String(d.code))
    ) {
      classification = "uncertain";
      cause = "computed-directional-alignment";
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
      if (d.property === "x" || d.property === "y") {
        const axis = d.property === "x" ? 0 : 1,
          size = axis + 2;
        const shiftedA = dn.get(layer.design ?? "") ?? a,
          shiftedB = cn.get(layer.code ?? "") ?? b;
        const parent = (n: CaptureNode) =>
          n.path.slice(0, n.path.lastIndexOf("/"));
        const previous = drifts.find((x) => {
          if (
            x.kind !== "layout" ||
            x.property !== (axis === 0 ? "width" : "height") ||
            Math.abs(Number(x.code) - Number(x.design) - delta) >= 0.05
          )
            return false;
          const pa = dn.get(x.designNode ?? ""),
            pb = cn.get(x.codeNode ?? "");
          return (
            !!pa &&
            !!pb &&
            parent(pa) === parent(shiftedA) &&
            parent(pb) === parent(shiftedB) &&
            Math.abs(pa.box[axis]! - pb.box[axis]!) < 0.05 &&
            Math.abs(shiftedA.box[axis]! - pa.box[axis]! - pa.box[size]!) <
              0.05 &&
            Math.abs(shiftedB.box[axis]! - pb.box[axis]! - pb.box[size]!) < 0.05
          );
        });
        if (previous)
          layer = { design: previous.designNode!, code: previous.codeNode! };
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
    if (
      classification === "product" &&
      /^(background-|box-shadow$|border-.*-(color|style|radius)$)/.test(
        d.property,
      )
    ) {
      cause = "style:surface";
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
      cause === "style:surface"
        ? "style"
        : cause === "layout:configuration"
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
    record(layer, kind, cause, classification, d.id);
  }
  return [...groups.values()];
}
