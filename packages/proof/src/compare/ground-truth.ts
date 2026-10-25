import type { CaptureNode, Defect, Drift } from "./types.ts";

/** RFC4180 subset including quoted commas, quotes and newlines. */
export function csv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" && !quoted) {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  const keys = rows.shift()!;
  return rows
    .filter((r) => r.some(Boolean))
    .map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}
const rate = (n: number, d: number) => (d ? n / d : null);
export function correspondenceMetrics(
  report: {
    matches: {
      designNode: string;
      codeNode: string;
      uncertain?: true;
      wrappers?: { design: string[]; code: string[] };
    }[];
  },
  labels: Record<string, string>[],
  design: CaptureNode[],
  code: CaptureNode[],
) {
  const dp = new Map(design.map((n) => [n.fdnId || n.path, n.path])),
    cp = new Map(code.map((n) => [n.fdnId || n.path, n.path]));
  let tp = 0,
    fp = 0,
    fn = 0,
    abstained = 0,
    unsure = 0;
  const errors = [];
  // Only transparent coextensive wrappers with no divergent branches are equivalent.
  const equivalent = (a: string, b: string) => {
    if (a === b) return true;
    const parent = code.find((n) => n.path === (a.length < b.length ? a : b)),
      child = code.find((n) => n.path === (a.length < b.length ? b : a));
    if (
      !parent ||
      !child ||
      !child.path.startsWith(parent.path + "/") ||
      parent.text?.trim() ||
      parent.role ||
      parent.name ||
      !parent.box.every((v, i) => Math.abs(v - child.box[i]!) < 0.05)
    )
      return false;
    if (
      code.some(
        (n) =>
          n.path.startsWith(parent.path + "/") &&
          !n.path.startsWith(child.path + "/") &&
          n !== child &&
          !child.path.startsWith(n.path + "/"),
      )
    )
      return false;
    return (
      ["background-color", "box-shadow"].every(
        (p) =>
          !parent.style[p] ||
          ["none", "transparent", "rgba(0, 0, 0, 0)"].includes(
            parent.style[p]!,
          ),
      ) &&
      ["top", "right", "bottom", "left"].every(
        (p) => !parseFloat(parent.style[`border-${p}-width`] || "0"),
      )
    );
  };
  for (const l of labels) {
    if (l.confidence !== "sure") {
      unsure++;
      continue;
    }
    const prediction = report.matches.find(
      (m) => (dp.get(m.designNode) ?? m.designNode) === l.design_path,
    );
    const expected = l.code_path !== "none";
    if (!prediction || prediction.uncertain) {
      if (expected) fn++;
      if (prediction?.uncertain) abstained++;
      continue;
    }
    const actual = cp.get(prediction.codeNode) ?? prediction.codeNode;
    if (expected && equivalent(actual, l.code_path!)) tp++;
    else {
      fp++;
      if (expected) fn++;
      errors.push({ design: l.design_fdn_id, expected: l.code_path, actual });
    }
  }
  return {
    tp,
    fp,
    fn,
    precision: rate(tp, tp + fp),
    recall: rate(tp, tp + fn),
    abstained,
    excludedUnsure: unsure,
    errors,
  };
}
function inScope(actual: string | undefined, scope: string | undefined) {
  if (!actual || !scope || scope === "none") return false;
  return scope.split(";").some((pattern) => {
    if (pattern === "*") return true;
    const p = pattern.split("/"),
      a = actual.split("/");
    return a.length >= p.length && p.every((s, i) => s === "*" || s === a[i]);
  });
}
const sides = ['top', 'right', 'bottom', 'left'];
const shorthandProperties: Record<string, string[]> = {
  ...Object.fromEntries(['color', 'width', 'style'].map(p => [`border-${p}`, sides.map(side => `border-${side}-${p}`)])),
  padding: sides.map(side => `padding-${side}`),
  margin: sides.map(side => `margin-${side}`),
  inset: sides,
  gap: ['row-gap', 'column-gap'],
  'border-radius': ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map(corner => `border-${corner}-radius`),
  font: ['font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch', 'font-variant', 'line-height'],
};
export function expandLabelProperties(properties: string[]): string[] {
  return [...new Set(properties.flatMap(property => [property, ...(shorthandProperties[property] ?? [])]))];
}
/** One-to-one assignment prevents many checker rows claiming one labelled cause. */
export function defectMetrics(
  defects: Defect[],
  drifts: Drift[],
  labels: Record<string, string>[],
  design: CaptureNode[],
  code: CaptureNode[],
  options: { expandShorthands?: boolean } = {},
) {
  const truth = labels.filter((l) => l.kind !== "environment");
  const predicted = defects.filter((d) => d.classification === "product");
  const dp = new Map(design.map((n) => [n.fdnId || n.path, n.path])),
    cp = new Map(code.map((n) => [n.fdnId || n.path, n.path]));
  const raw = new Map(drifts.map((d) => [d.id, d]));
  const candidates = predicted.map((d) =>
    truth
      .map((l, i) => {
        const original = l.properties?.split(";").map(p => p.trim()) ?? [];
        const properties = options.expandShorthands === false ? original : expandLabelProperties(original);
        const support = d.findings
          .map((id) => raw.get(id)!)
          .filter(Boolean)
          .filter((r) => {
            const prop =
              properties.includes(r.property) ||
              (properties.includes("subtree") &&
                (r.kind === "missing" || r.kind === "extra")) ||
              (properties.includes("layout") && r.kind === "layout");
            return (
              prop &&
              (inScope(
                dp.get(r.designNode ?? "") ?? r.designNode,
                l.design_layer,
              ) ||
                inScope(cp.get(r.codeNode ?? "") ?? r.codeNode, l.code_layer))
            );
          }).length;
        return { i, support };
      })
      .filter((x) => x.support > 0)
      .sort((a, b) => b.support - a.support),
  );
  const owner = new Map<number, number>();
  const assign = (i: number, seen: Set<number>): boolean => {
    for (const candidate of candidates[i] ?? []) {
      if (seen.has(candidate.i)) continue;
      seen.add(candidate.i);
      const old = owner.get(candidate.i);
      if (old === undefined || assign(old, seen)) {
        owner.set(candidate.i, i);
        return true;
      }
    }
    return false;
  };
  // Restrictive candidates first, then higher raw support; deterministic maximum cardinality.
  predicted
    .map((_, i) => i)
    .sort((a, b) => candidates[a]!.length - candidates[b]!.length)
    .forEach((i) => assign(i, new Set()));
  const matched = new Set(owner.values());
  const tp = owner.size,
    fp = predicted.length - tp,
    fn = truth.length - tp;
  return {
    tp,
    fp,
    fn,
    precision: rate(tp, tp + fp),
    recall: rate(tp, tp + fn),
    predicted: predicted.length,
    labelled: truth.length,
    agreement: [...owner].map(([t, p]) => ({
      defect: predicted[p]!.id,
      label: truth[t]!.id,
      description: truth[t]!.description,
    })),
    falsePositives: predicted.filter((_, i) => !matched.has(i)),
    falseNegatives: truth.filter((_, i) => !owner.has(i)),
  };
}
