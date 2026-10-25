import type { CaptureNode, Match } from "./types.ts";
const clear = (v = "") =>
  !v || v === "none" || v === "transparent" || /^rgba\([^)]*,\s*0\)$/.test(v);
export function visual(n: CaptureNode) {
  const s = n.style;
  return (
    n.box[2] > 0 &&
    n.box[3] > 0 &&
    s.display !== "none" &&
    s.visibility !== "hidden" &&
    s.opacity !== "0" &&
    (!!n.text?.trim() ||
      !!n.role ||
      ["img", "svg", "input", "button", "canvas", "video"].includes(n.tag) ||
      !clear(s["background-color"]) ||
      !clear(s["background-image"]) ||
      !clear(s["box-shadow"]) ||
      ["top", "right", "bottom", "left"].some(
        (k) => parseFloat(s[`border-${k}-width`] || "0") > 0,
      ) ||
      ["flex", "grid", "inline-flex", "inline-grid"].includes(s.display || ""))
  );
}
function iou(a: CaptureNode, b: CaptureNode) {
  const [x, y, w, h] = a.box,
    [u, v, p, q] = b.box;
  const n =
    Math.max(0, Math.min(x + w, u + p) - Math.max(x, u)) *
    Math.max(0, Math.min(y + h, v + q) - Math.max(y, v));
  return n / (w * h + p * q - n || 1);
}
function contexts(nodes: CaptureNode[]) {
  const result = new Map<string, Set<string>>();
  for (const n of nodes) {
    const text = n.text?.trim();
    if (!text) continue;
    const parts = n.path.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const key = parts.slice(0, i).join("/");
      if (!result.has(key)) result.set(key, new Set());
      result.get(key)!.add(text);
    }
  }
  return result;
}
function anchorContexts(
  nodes: CaptureNode[],
  other: CaptureNode[],
  context: Map<string, Set<string>>,
) {
  const count = (list: CaptureNode[]) => {
    const result = new Map<string, number>();
    for (const n of list) {
      const t = n.text?.trim();
      if (t) result.set(t, (result.get(t) ?? 0) + 1);
    }
    return result;
  };
  const counts = count(nodes),
    otherCounts = count(other),
    unique = new Set(
      [...counts]
        .filter(([t, n]) => n === 1 && otherCounts.get(t) === 1)
        .map(([t]) => t),
    ),
    anchors = new Map<string, Set<string>>();
  for (const n of nodes) {
    const parts = n.path.split("/");
    for (let i = parts.length - 1; i >= 1; i--) {
      const candidates = new Set(
        [...(context.get(parts.slice(0, i).join("/")) ?? [])].filter(
          (t) => unique.has(t) && t !== n.text?.trim(),
        ),
      );
      if (candidates.size) {
        anchors.set(n.path, candidates);
        break;
      }
    }
  }
  return { counts, anchors };
}
function cost(
  a: CaptureNode,
  b: CaptureNode,
  dc: Map<string, Set<string>>,
  cc: Map<string, Set<string>>,
  da: ReturnType<typeof anchorContexts>,
  ca: ReturnType<typeof anchorContexts>,
  shapes: Map<CaptureNode, string>,
) {
  if ((a.tag === "svg") !== (b.tag === "svg")) return 1;
  if (
    ["circle", "path", "rect", "line", "polygon"].includes(a.tag) &&
    a.tag !== b.tag
  )
    return 1;
  // Primitive structure separates unrelated anonymous icons; position is not identity.
  if (a.tag === "svg" && b.tag === "svg" && shapes.get(a) !== shapes.get(b))
    return 1;
  const text = (a.text || a.name || "").trim(),
    other = (b.text || b.name || "").trim();
  if (
    text &&
    text === other &&
    ((da.counts.get(text) ?? 0) > 1 || (ca.counts.get(text) ?? 0) > 1)
  ) {
    // Repeated type labels such as ACTION are not identities across rearranged rows.
    if (/^[A-Z\s]+$/.test(text) && iou(a, b) < 0.75) return 1;
    const left = da.anchors.get(a.path),
      right = ca.anchors.get(b.path);
    if (left?.size && right?.size) {
      if (![...left].some((t) => right.has(t))) return 1;
    } else if (iou(a, b) < 0.75) return 1;
  }
  let textDistance = text && text === other ? 0 : text && other ? 1 : 0.7;
  if (!text && !other) {
    const left = dc.get(a.path) ?? new Set<string>(),
      right = cc.get(b.path) ?? new Set<string>();
    const common = [...left].filter((t) => right.has(t)).length;
    if (left.size || right.size) {
      if (!common) {
        if (
          a.path === b.path &&
          a.path.split("/").length <= 2 &&
          iou(a, b) > 0.1
        )
          textDistance = 0.5;
        else return 1;
      } else textDistance = 1 - (2 * common) / (left.size + right.size);
    } else {
      if (iou(a, b) === 0) return 1;
      textDistance = 0.5;
    }
  }
  return (
    0.4 * textDistance +
    0.15 *
      (a.tag === b.tag ||
      (!text && !other && a.tag !== "svg" && b.tag !== "svg")
        ? 0
        : 1) +
    0.15 *
      ((a.role || "") === (b.role || "") && (a.name || "") === (b.name || "")
        ? 0
        : 1) +
    0.25 * (1 - iou(a, b)) +
    0.05 * (a.path === b.path ? 0 : 1)
  );
}
// Minimum-cost rectangular assignment, with dummy columns for unmatched nodes.
function assign(a: number[][]): number[] {
  const n = a.length,
    m = a[0]?.length || 0,
    u = Array(n + 1).fill(0),
    v = Array(m + 1).fill(0),
    p = Array(m + 1).fill(0),
    way = Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const min = Array(m + 1).fill(Infinity),
      used = Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity,
        j1 = 0;
      for (let j = 1; j <= m; j++)
        if (!used[j]) {
          const cur = a[i0 - 1]![j - 1]! - u[i0] - v[j];
          if (cur < min[j]) {
            min[j] = cur;
            way[j] = j0;
          }
          if (min[j] < delta) {
            delta = min[j];
            j1 = j;
          }
        }
      for (let j = 0; j <= m; j++)
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else min[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const out = Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) out[p[j] - 1] = j - 1;
  return out;
}
function visibleInCapture(
  nodes: CaptureNode[],
  viewport?: { width: number; height: number },
) {
  if (!viewport) return nodes;
  const paths = new Map(nodes.map((n) => [n.path, n]));
  return nodes.filter((n) => {
    let [x, y, w, h] = n.box,
      left = Math.max(0, x),
      top = Math.max(0, y),
      right = Math.min(viewport.width, x + w),
      bottom = Math.min(viewport.height, y + h);
    const parts = n.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const p = paths.get(parts.slice(0, i).join("/"));
      if (!p) continue;
      if (
        p.style.opacity === "0" ||
        p.style.display === "none" ||
        p.style.visibility === "hidden"
      )
        return false;
      const [px, py, pw, ph] = p.box;
      if (/hidden|clip|auto|scroll/.test(p.style["overflow-x"] || "")) {
        left = Math.max(left, px);
        right = Math.min(right, px + pw);
      }
      if (/hidden|clip|auto|scroll/.test(p.style["overflow-y"] || "")) {
        top = Math.max(top, py);
        bottom = Math.min(bottom, py + ph);
      }
    }
    return right > left && bottom > top;
  });
}
export function matchNodes(
  design: CaptureNode[],
  code: CaptureNode[],
  viewport?: { width: number; height: number },
) {
  design = visibleInCapture(design, viewport);
  code = visibleInCapture(code, viewport);
  const d = design.filter(visual),
    c = code.filter(visual),
    matches: Match[] = [],
    usedD = new Set<CaptureNode>(),
    usedC = new Set<CaptureNode>();
  for (const a of d)
    if (a.fdnId) {
      const ds = d.filter((n) => n.fdnId === a.fdnId),
        cs = c.filter((n) => n.fdnId === a.fdnId);
      if (ds.length === 1 && cs.length === 1) {
        const b = cs[0]!;
        matches.push({ design: a, code: b, kind: "id", confidence: 1 });
        usedD.add(a);
        usedC.add(b);
      }
    }
  const shapes = new Map(
    [...design, ...code]
      .filter((n) => n.tag === "svg")
      .map((n) => [
        n,
        (design.includes(n) ? design : code)
          .filter((c) => c.path.startsWith(n.path + "/") && c.tag !== "g")
          .map((c) => c.tag)
          .sort()
          .join(","),
      ]),
  );
  const dc = contexts(design),
    cc = contexts(code);
  const da = anchorContexts(design, code, dc),
    ca = anchorContexts(code, design, cc);
  const left = d.filter((n) => !usedD.has(n)),
    right = c.filter((n) => !usedC.has(n));
  if (left.length) {
    const matrix = left.map((a) => [
      ...right.map((b) => cost(a, b, dc, cc, da, ca, shapes)),
      ...left.map(() => 0.48),
    ]);
    const assignment = assign(matrix);
    left.forEach((a, i) => {
      const j = assignment[i]!;
      if (j >= 0 && j < right.length && matrix[i]![j]! < 0.48) {
        const b = right[j]!;
        const alternatives = right.filter(
          (other, k) =>
            k !== j && Math.abs(matrix[i]![k]! - matrix[i]![j]!) < 0.035,
        );
        const ambiguous =
          alternatives.length > 0 &&
          !(
            a.text?.trim() &&
            a.text.trim() === b.text?.trim() &&
            da.counts.get(a.text.trim()) === 1 &&
            ca.counts.get(a.text.trim()) === 1
          );
        matches.push({
          ...(ambiguous
            ? {
                uncertain: true as const,
                reason:
                  "Several candidates have indistinguishable correspondence evidence",
              }
            : {}),
          design: a,
          code: b,
          kind: "heuristic",
          confidence: Math.round((1 - matrix[i]![j]!) * 1000) / 1000,
        });
        usedD.add(a);
        usedC.add(b);
      }
    });
  }
  // Transparent, coextensive single-child wrappers are one correspondence.
  // Keep their paths for audit rather than reporting a missing/extra subtree.
  for (const m of matches) {
    const wrappers = { design: [] as string[], code: [] as string[] };
    for (const [side, nodes, used, matched] of [
      ["design", d, usedD, m.design],
      ["code", c, usedC, m.code],
    ] as const) {
      for (const n of nodes) {
        if (
          used.has(n) ||
          !matched.path.startsWith(n.path + "/") ||
          n.fdnId ||
          n.text?.trim() ||
          n.role ||
          n.name
        )
          continue;
        if (
          !clear(n.style["background-color"]) ||
          !clear(n.style["background-image"]) ||
          !clear(n.style["box-shadow"]) ||
          ["top", "right", "bottom", "left"].some(
            (k) => parseFloat(n.style[`border-${k}-width`] || "0") > 0,
          )
        )
          continue;
        const coextensive = n.box.every(
          (v, i) => Math.abs(v - matched.box[i]!) < 0.05,
        );
        const subtree = nodes.filter((x) => x.path.startsWith(n.path + "/"));
        const ownPaint = (x: CaptureNode) =>
          !!x.text?.trim() ||
          !!x.role ||
          !!x.name ||
          ["svg", "img", "button", "input", "canvas", "video"].includes(
            x.tag,
          ) ||
          !clear(x.style["background-color"]) ||
          !clear(x.style["background-image"]) ||
          !clear(x.style["box-shadow"]) ||
          ["top", "right", "bottom", "left"].some(
            (k) => parseFloat(x.style[`border-${k}-width`] || "0") > 0,
          );
        if (!coextensive && subtree.some((x) => ownPaint(x) && !used.has(x)))
          continue;
        const descendants = nodes.filter(
          (x) =>
            x.path.startsWith(n.path + "/") &&
            x !== matched &&
            !x.path.startsWith(matched.path + "/") &&
            !matched.path.startsWith(x.path + "/"),
        );
        if (coextensive && descendants.length) continue;
        used.add(n);
        wrappers[side].push(n.fdnId || n.path);
      }
    }
    if (wrappers.design.length || wrappers.code.length) m.wrappers = wrappers;
  }
  return {
    matches,
    missing: d.filter((n) => !usedD.has(n)),
    extra: c.filter((n) => !usedC.has(n)),
  };
}
