import { seal, canonical, hash } from "./canonical.ts";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { matchNodes } from "./match.ts";
import { properties, equal, token } from "./style.ts";
import {
  defaults,
  type Capture,
  type Drift,
  type Tolerances,
} from "./types.ts";
export async function readCapture(dir: string): Promise<Capture> {
  const [dom, meta, screenshot] = await Promise.all([
    readFile(path.join(dir, "dom.json"), "utf8"),
    readFile(path.join(dir, "meta.json"), "utf8"),
    readFile(path.join(dir, "screenshot.png")),
  ]);
  const nodes = JSON.parse(dom).nodes;
  if (
    !Array.isArray(nodes) ||
    nodes.some(
      (n) =>
        !n ||
        typeof n.path !== "string" ||
        typeof n.tag !== "string" ||
        !Array.isArray(n.box) ||
        n.box.length !== 4 ||
        n.box.some(
          (v: unknown) => typeof v !== "number" || !Number.isFinite(v),
        ) ||
        !n.style ||
        Object.values(n.style).some((v) => typeof v !== "string"),
    )
  )
    throw Error(
      "dom.json needs nodes with path, tag, finite box[4] and string styles",
    );
  return { nodes, meta: JSON.parse(meta), screenshot };
}
export function compare(
  design: Capture,
  code: Capture,
  tolerances: Partial<Tolerances> = {},
) {
  const start = performance.now(),
    t = { ...defaults, ...tolerances },
    a = PNG.sync.read(design.screenshot),
    b = PNG.sync.read(code.screenshot);
  if (
    Object.values(t).some((v) => !Number.isFinite(v) || v < 0) ||
    t.pixelRatio > 1 ||
    t.pixelThreshold > 1
  )
    throw Error("Invalid comparison tolerances");
  for (const k of ["artboard", "state", "viewport"])
    if (
      design.meta[k] !== undefined &&
      code.meta[k] !== undefined &&
      canonical(design.meta[k]) !== canonical(code.meta[k])
    )
      throw Error(`Capture ${k} differs`);
  if (a.width !== b.width || a.height !== b.height)
    throw Error(
      "Capture image dimensions differ; capture the same viewport and DPR",
    );
  const diff = new PNG({ width: a.width, height: a.height });
  const count = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
    threshold: t.pixelThreshold,
    includeAA: false,
  });
  const { matches, missing, extra } = matchNodes(design.nodes, code.nodes, {
      width: a.width / (design.meta.viewport?.dpr ?? 1),
      height: a.height / (design.meta.viewport?.dpr ?? 1),
    }),
    drifts: Drift[] = [];
  const add = (d: Omit<Drift, "id">) =>
    drifts.push({ id: `d${drifts.length + 1}`, ...d });
  for (const m of matches) {
    const a = m.design,
      b = m.code,
      base = {
        designNode: a.fdnId || a.path,
        codeNode: b.fdnId || b.path,
        match: m.kind,
        confidence: m.confidence,
        designBox: a.box,
        codeBox: b.box,
      };
    a.box.forEach((v, i) => {
      if (Math.abs(v - b.box[i]!) > t.boxPx)
        add({
          ...base,
          kind: "layout",
          property: ["x", "y", "width", "height"][i]!,
          design: v,
          code: b.box[i],
        });
    });
    if ((a.text || "").trim() !== (b.text || "").trim())
      add({
        ...base,
        kind: "text",
        property: "text",
        design: a.text ?? "",
        code: b.text ?? "",
      });
    for (const p of properties) {
      const textProperty =
        /^(font-|line-height|letter-spacing|text-|white-space|color$)/.test(p);
      if (
        textProperty &&
        !a.text?.trim() &&
        !b.text?.trim() &&
        !["input", "button", "select", "textarea", "svg"].includes(a.tag) &&
        !["input", "button", "select", "textarea", "svg"].includes(b.tag)
      )
        continue;
      const border = /^border-(top|right|bottom|left)-(color|style)$/.exec(p);
      if (
        border &&
        [a, b].every(
          (n) => parseFloat(n.style[`border-${border[1]}-width`] || "0") === 0,
        )
      )
        continue;
      const av = a.style[p],
        bv = b.style[p];
      if (av === undefined && bv === undefined) continue;
      if (av === undefined || bv === undefined) {
        add({
          ...base,
          kind: "style",
          property: p,
          design: av ?? null,
          code: bv ?? null,
        });
        continue;
      }
      if (!equal(av, bv, t.stylePx, t.colorDeltaE)) {
        const tokens = { ...design.meta.tokens, ...a.vars },
          dt = token(av, tokens),
          ct = token(bv, tokens);
        add({
          ...base,
          kind: dt ? "token" : "style",
          property: p,
          design: av,
          code: bv,
          token: { design: dt, code: ct },
        });
      }
    }
  }
  for (const n of missing)
    add({
      kind: "missing",
      designNode: n.fdnId || n.path,
      confidence: 0,
      property: "node",
      designBox: n.box,
    });
  for (const n of extra)
    add({
      kind: "extra",
      codeNode: n.fdnId || n.path,
      confidence: 0,
      property: "node",
      codeBox: n.box,
    });
  const unavailable = properties.filter((p) =>
    [...design.nodes, ...code.nodes].some((n) => n.style[p] === undefined),
  );
  const failure = [design, code].find(
    (c) =>
      c.meta.provable === false ||
      c.meta.dirty === true ||
      c.meta.rendererDirty === true ||
      c.meta.errors?.length ||
      c.meta.blocked?.length,
  );
  const reason = failure
    ? String(
        failure.meta.reason ||
          (failure.meta.dirty || failure.meta.rendererDirty
            ? "Capture was produced from uncommitted source changes"
            : failure.meta.errors?.length || failure.meta.blocked?.length
              ? "Capture had runtime errors or blocked network requests"
              : "Capture producer marked this state not-provable"),
      )
    : unavailable.length
      ? "Capture lacks visual properties: " + unavailable.join(", ")
      : null;
  const meta = design.meta;
  const report = {
    schema: "fdn-drift/0",
    artboard: meta.artboard ?? "unknown",
    state: meta.state ?? "default",
    viewport: meta.viewport ?? { width: a.width, height: a.height, dpr: 1 },
    design: {
      file: meta.file ?? meta.designFile ?? null,
      head: meta.designHead ?? null,
      htmlSha256: meta.htmlSha256 ?? null,
      binding: meta.binding ?? "chain-head",
    },
    code: {
      repo: code.meta.repo ?? null,
      commit: code.meta.commit ?? null,
      root: code.meta.root ?? null,
    },
    provable: !reason,
    ...(reason
      ? {
          reason,
          notProvable: {
            reason,
            detail: failure?.meta.notProvable?.detail ?? reason,
            fix:
              failure?.meta.notProvable?.fix ??
              (failure
                ? "Provide a renderable fixture for the requested state without changing its meaning."
                : "Recapture both sides with the shared visual property list."),
          },
        }
      : {}),
    styles: { properties, unavailable },
    matching: {
      algorithm: "hungarian",
      maxCost: 0.48,
      weights: { text: 0.4, tag: 0.15, roleName: 0.15, iou: 0.25, path: 0.05 },
      containerText: "descendant-Dice",
      confidence: "1-cost; uncalibrated",
    },
    tolerances: t,
    pixels: {
      diffRatio: count / (a.width * a.height),
      diffPixels: count,
      diffImage: "diff.png",
      designImage: "design.png",
      codeImage: "code.png",
    },
    drifts,
    matches: matches.map((m) => ({
      designNode: m.design.fdnId || m.design.path,
      codeNode: m.code.fdnId || m.code.path,
      kind: m.kind,
      confidence: m.confidence,
    })),
    verdict: reason
      ? "not-provable"
      : drifts.length || count / (a.width * a.height) > t.pixelRatio
        ? "drift"
        : "match",
    timingsMs: { compare: performance.now() - start },
  };
  return { report: seal(report), diff: PNG.sync.write(diff) };
}
export function captureHash(c: Capture) {
  return hash({
    nodes: c.nodes,
    meta: c.meta,
    image: c.screenshot.toString("base64"),
  });
}
export async function compareDirectories(
  designDir: string,
  codeDir: string,
  out: string,
  tolerances: Partial<Tolerances> = {},
) {
  const [a, b] = await Promise.all([
    readCapture(designDir),
    readCapture(codeDir),
  ]);
  const result = compare(a, b, tolerances);
  const report = seal({
    ...result.report,
    inputs: {
      design: "design-capture",
      code: "code-capture",
      designHash: captureHash(a),
      codeHash: captureHash(b),
    },
  });
  await mkdir(out, { recursive: true });
  await Promise.all([
    writeFile(path.join(out, "drift-report.json"), canonical(report) + "\n"),
    writeFile(path.join(out, "diff.png"), result.diff),
    writeFile(path.join(out, "design.png"), a.screenshot),
    writeFile(path.join(out, "code.png"), b.screenshot),
  ]);
  for (const [name, c] of [
    ["design", a],
    ["code", b],
  ] as const) {
    const dir = path.join(out, name + "-capture");
    await mkdir(dir, { recursive: true });
    await Promise.all([
      writeFile(path.join(dir, "dom.json"), canonical({ nodes: c.nodes })),
      writeFile(path.join(dir, "meta.json"), canonical(c.meta)),
      writeFile(path.join(dir, "screenshot.png"), c.screenshot),
    ]);
  }
  return report;
}
