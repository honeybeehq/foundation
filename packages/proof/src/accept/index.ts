import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { canonical, hash, seal } from "../compare/canonical.ts";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import type { Capture, Drift } from "../compare/types.ts";

export interface Acceptance {
  id: string;
  scope: {
    artboard: string;
    state: string;
    viewport: { width: number; height: number; dpr: number };
  };
  layer: { design?: string; code?: string };
  kind: string;
  code: { component: string; pixelsSha256: string };
  values: unknown[];
  reason: string;
  reviewer: string;
  date: string;
  design: { htmlSha256: string; head: string };
}
export interface AcceptedList {
  schema: "fdn-accepted/0";
  entries: Acceptance[];
}
export const emptyList = (): AcceptedList => ({
  schema: "fdn-accepted/0",
  entries: [],
});
export function parseList(value: any): AcceptedList {
  if (value?.schema !== "fdn-accepted/0" || !Array.isArray(value.entries))
    throw Error("Expected fdn-accepted/0 entries");
  const ids = new Set<string>();
  for (const e of value.entries) {
    if (
      !e ||
      typeof e.id !== "string" ||
      !e.id ||
      !e.scope ||
      typeof e.scope.artboard !== "string" ||
      typeof e.scope.state !== "string" ||
      !e.scope.viewport ||
      ["width", "height", "dpr"].some(
        (k) =>
          !Number.isFinite(e.scope.viewport[k]) || e.scope.viewport[k] <= 0,
      ) ||
      !e.layer ||
      !Object.values(e.layer).some((v) => typeof v === "string" && v.length) ||
      typeof e.kind !== "string" ||
      typeof e.code?.component !== "string" ||
      !e.code.component ||
      !/^[a-f0-9]{64}$/.test(e.code.pixelsSha256 ?? "") ||
      !Array.isArray(e.values) ||
      !e.values.length ||
      ![e.reason, e.reviewer].every((v) => typeof v === "string" && v.trim()) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(e.date ?? "") ||
      !/^[a-f0-9]{64}$/.test(e.design?.htmlSha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(e.design?.head ?? "")
    )
      throw Error(`Invalid accepted difference: ${e?.id ?? "unknown"}`);
    const key = canonical({ id: e.id, scope: e.scope });
    if (ids.has(key)) throw Error(`Duplicate accepted difference: ${e.id}`);
    ids.add(key);
  }
  return value;
}
export async function readAccepted(file: string): Promise<AcceptedList> {
  try {
    return parseList(JSON.parse(await readFile(file, "utf8")));
  } catch (e: any) {
    if (e.code === "ENOENT") return emptyList();
    throw e;
  }
}
export const scopeOf = (r: any) => ({
  artboard: r.artboard,
  state: r.state,
  viewport: r.viewport,
});
/** Values exclude raw sequence IDs/confidence, which can change when unrelated findings appear. */
export function valuesOf(r: any, defect: any): unknown[] {
  const ids = new Set(defect.findings);
  return (r.drifts as Drift[])
    .filter((d) => ids.has(d.id))
    .map((d) => ({
      layer: {
        ...(d.designNode ? { design: d.designNode } : {}),
        ...(d.codeNode ? { code: d.codeNode } : {}),
      },
      kind: d.kind,
      property: d.property,
      design: d.design ?? null,
      code: d.code ?? null,
      ...(d.kind === "missing" || d.kind === "extra"
        ? {
            designBox: d.designBox ?? null,
            codeBox: d.codeBox ?? null,
            subtree: r.acceptanceSubtrees?.[d.id] ?? null,
          }
        : {}),
    }))
    .sort((a, b) => canonical(a).localeCompare(canonical(b)));
}
/** Compatibility for old reports only. R2's defects[] is authoritative when present. */
export function defectsOf(r: any): any[] {
  if (Array.isArray(r.defects)) return r.defects;
  const groups = new Map<string, any>();
  for (const d of r.drifts ?? []) {
    const layer = {
      ...(d.designNode ? { design: d.designNode } : {}),
      ...(d.codeNode ? { code: d.codeNode } : {}),
    };
    const cause = d.property,
      key = canonical({ layer, kind: d.kind, cause });
    if (!groups.has(key))
      groups.set(key, {
        id: "legacy-" + hash({ layer, kind: d.kind, cause }).slice(0, 16),
        layer,
        kind: d.kind,
        cause,
        classification: "product",
        findings: [],
        summary: `${d.kind}: ${d.property}`,
      });
    groups.get(key).findings.push(d.id);
  }
  return [...groups.values()];
}
export function makeAcceptance(
  r: any,
  id: string,
  reason: string,
  reviewer: string,
): Acceptance {
  const defect = defectsOf(r).find((d) => d.id === id);
  if (!r.provable || !defect) throw Error(`Unknown defect: ${id}`);
  if (defect.classification && defect.classification !== "product")
    throw Error("Only product differences can be accepted");
  if (!reason.trim() || !reviewer.trim())
    throw Error("A reason and reviewer are required");
  if (
    (defect.kind === "extra" || defect.kind === "missing") &&
    defect.findings.some((id: string) => !r.acceptanceSubtrees?.[id])
  )
    throw Error(
      "Cannot accept subtree without captured contents; regenerate the proof",
    );
  const entry = {
    id,
    scope: scopeOf(r),
    layer: defect.layer,
    kind: defect.kind,
    code: {
      component: r.code?.root,
      pixelsSha256: r.acceptancePixelHashes?.[id],
    },
    values: valuesOf(r, defect),
    reason,
    reviewer,
    date: new Date().toISOString().slice(0, 10),
    design: { htmlSha256: r.design.htmlSha256, head: r.design.head },
  };
  parseList({ schema: "fdn-accepted/0", entries: [entry] });
  return entry;
}
export function evaluateAccepted(r: any, list: AcceptedList) {
  const errors: string[] = [],
    accepted: string[] = [];
  const scoped = list.entries.filter(
    (e) => canonical(e.scope) === canonical(scopeOf(r)),
  );
  const defects = defectsOf(r);
  for (const e of scoped) {
    const d = defects.find((d) => d.id === e.id);
    if (
      e.design.htmlSha256 !== r.design?.htmlSha256 ||
      e.design.head !== r.design?.head
    )
      errors.push(
        `${e.id}: design changed since this difference was accepted; re-review or update the design`,
      );
    else if (!d)
      errors.push(
        `${e.id}: unknown accepted difference; remove it or re-review`,
      );
    else if (
      (d.classification && d.classification !== "product") ||
      canonical(e.layer) !== canonical(d.layer) ||
      e.kind !== d.kind ||
      e.code.component !== r.code?.root ||
      e.code.pixelsSha256 !== r.acceptancePixelHashes?.[d.id] ||
      canonical(e.values) !== canonical(valuesOf(r, d))
    )
      errors.push(
        `${e.id}: code or measured value changed since this difference was accepted; re-review or update the design`,
      );
    else accepted.push(e.id);
  }
  return {
    errors,
    accepted,
    defects: defects.map((d) => {
      const { accepted: _old, ...clean } = d;
      const e = scoped.find((e) => e.id === d.id && accepted.includes(d.id));
      return e
        ? { ...clean, accepted: { entryId: e.id, reason: e.reason } }
        : clean;
    }),
  };
}
export function bindAccepted(
  r: any,
  list: AcceptedList,
  captures?: { design: Capture; code: Capture },
) {
  if (captures) r = withAcceptanceInputs(r, captures);
  const result = evaluateAccepted(r, list);
  return seal({
    ...r,
    ...(captures ? { acceptedPixels: residualPixels(r, list, captures) } : {}),
    acceptedList: list,
    acceptedListHash: hash(list),
    defects: result.defects,
    summary: {
      ...r.summary,
      uniqueDefects: result.defects.filter(
        (d) => !d.classification || d.classification === "product",
      ).length,
      accepted: result.accepted.length,
      raw: r.drifts.length,
      uncertainMatches: r.summary?.uncertainMatches ?? 0,
    },
  });
}
export function hasUnacceptedDrift(
  r: any,
  list: AcceptedList,
  residualRatio?: number,
  environmentCauses: string[] = [],
): boolean {
  const { defects, accepted, errors } = evaluateAccepted(r, list);
  if (
    errors.length ||
    defects.some(
      (d) =>
        !(
          d.classification === "environment" &&
          environmentCauses.includes(d.cause)
        ) && !accepted.includes(d.id),
    )
  )
    return true;
  const explained = new Set(defects.flatMap((d) => d.findings));
  if ((r.drifts ?? []).some((d: Drift) => !explained.has(d.id))) return true;
  // Acceptance never excuses pixel-only drift without a measured layer explanation.
  const ratio = accepted.length ? residualRatio : r.pixels?.diffRatio;
  return !Number.isFinite(ratio) || ratio! > r.tolerances?.pixelRatio;
}

/** Full present-side subtree snapshots make same-box content edits stale. */
export function withAcceptanceInputs(
  r: any,
  captures: { design: Capture; code: Capture },
) {
  const subtrees: Record<string, string> = {};
  for (const d of r.drifts ?? []) {
    if (d.kind !== "missing" && d.kind !== "extra") continue;
    const nodes = captures[d.kind === "missing" ? "design" : "code"].nodes;
    const id = d.kind === "missing" ? d.designNode : d.codeNode;
    const root = nodes.find((n) => (n.fdnId || n.path) === id);
    if (!root) throw Error(`Cannot fingerprint subtree ${id}`);
    subtrees[d.id] = hash(
      nodes
        .filter(
          (n) => n.path === root.path || n.path.startsWith(root.path + "/"),
        )
        .map((n) => ({
          path: n.path.slice(root.path.length),
          tag: n.tag,
          text: n.text ?? "",
          box: n.box,
          style: n.style,
          authoredFontFamily: n.authoredFontFamily ?? null,
          vars: n.vars ?? {},
        })),
    );
  }
  const image = PNG.sync.read(captures.code.screenshot),
    pixelHashes: Record<string, string> = {};
  for (const defect of defectsOf(r)) {
    const ids = new Set(defect.findings),
      boxes = (r.drifts as Drift[])
        .filter((d) => ids.has(d.id))
        .flatMap((d) => [d.designBox, d.codeBox].filter(Boolean));
    const unique = [...new Set(boxes.map((b) => canonical(b)))]
      .sort()
      .map((b) => JSON.parse(b));
    const digest = createHash("sha256");
    digest.update(
      canonical({
        width: image.width,
        height: image.height,
        dpr: r.viewport.dpr,
        boxes: unique,
      }),
    );
    for (const [x, y, w, h] of unique) {
      const left = Math.min(
          image.width,
          Math.max(0, Math.floor(x * r.viewport.dpr)),
        ),
        right = Math.min(
          image.width,
          Math.max(0, Math.ceil((x + w) * r.viewport.dpr)),
        );
      for (
        let row = Math.max(0, Math.floor(y * r.viewport.dpr));
        row < Math.min(image.height, Math.ceil((y + h) * r.viewport.dpr));
        row++
      )
        if (right > left)
          digest.update(
            image.data.subarray(
              (row * image.width + left) * 4,
              (row * image.width + right) * 4,
            ),
          );
    }
    pixelHashes[defect.id] = digest.digest("hex");
  }
  return {
    ...r,
    acceptanceSubtrees: subtrees,
    acceptancePixelHashes: pixelHashes,
  };
}
/** Count real pixel changes outside accepted layers; source images remain untouched. */
export function residualPixels(
  r: any,
  list: AcceptedList,
  captures: { design: Capture; code: Capture },
) {
  const { accepted } = evaluateAccepted(r, list),
    ids = new Set(
      defectsOf(r)
        .filter((d) => accepted.includes(d.id))
        .flatMap((d) => d.findings),
    );
  const boxes = (r.drifts as Drift[])
    .filter((d) => ids.has(d.id))
    .flatMap((d) =>
      [d.designBox, d.codeBox].filter(
        (b): b is [number, number, number, number] => !!b,
      ),
    );
  const a = PNG.sync.read(captures.design.screenshot),
    b = PNG.sync.read(captures.code.screenshot);
  if (a.width !== b.width || a.height !== b.height)
    throw Error("Accepted pixel captures differ in dimensions");
  const diff = new PNG({ width: a.width, height: a.height });
  pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
    threshold: r.tolerances.pixelThreshold,
    includeAA: false,
    diffMask: true,
  });
  const covered = new Uint8Array(a.width * a.height),
    dpr = r.viewport.dpr;
  for (const [x, y, w, h] of boxes)
    for (
      let row = Math.max(0, Math.floor(y * dpr));
      row < Math.min(a.height, Math.ceil((y + h) * dpr));
      row++
    )
      covered.fill(
        1,
        row * a.width + Math.min(a.width, Math.max(0, Math.floor(x * dpr))),
        row * a.width +
          Math.max(0, Math.min(a.width, Math.ceil((x + w) * dpr))),
      );
  let residual = 0;
  for (let i = 0; i < covered.length; i++)
    if (!covered[i] && diff.data[i * 4 + 3]) residual++;
  return {
    residualPixels: residual,
    residualRatio: residual / (a.width * a.height),
    excludedBoxes: boxes,
    excludedPixels: covered.reduce((sum, p) => sum + p, 0),
    excludedRatio: covered.reduce((sum, p) => sum + p, 0) / covered.length,
  };
}
