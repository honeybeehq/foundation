/** Real Chromium mutation experiment. Run from the repository root. */
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  parseDocument,
  bakeDocument,
  loadChain,
} from "../../../engine/src/index.ts";
import { properties } from "./style.ts";
import { compare } from "./index.ts";
import type { Capture } from "./types.ts";
const input = process.argv[2] || "boards/tracks-pane.fdn.html";
const out = process.argv[3] || "packages/proof/src/compare/evidence";
await mkdir(out, { recursive: true });
const html = bakeDocument(parseDocument(await readFile(input, "utf8")).doc, {
  includeNodeIds: true,
}).html;
if (!html) throw Error("Design bake failed");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
});
await page.addInitScript("globalThis.__name = (f) => f");
await page.evaluate("globalThis.__name = (f) => f");
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
const head = loadChain(await readFile(input + ".chain")).head();
const htmlSha256 = createHash("sha256")
  .update(await readFile(input))
  .digest("hex");
async function capture(): Promise<Capture> {
  const nodes = await page.evaluate((props) => {
    const walk = (e: Element, path: string): any[] => {
      const s = getComputedStyle(e),
        r = e.getBoundingClientRect();
      return [
        {
          path,
          tag: e.tagName.toLowerCase(),
          fdnId: e.getAttribute("data-fdn-id"),
          role: e.getAttribute("role") || "",
          name: e.getAttribute("aria-label") || "",
          text: Array.from(e.childNodes)
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent)
            .join("")
            .trim(),
          box: [r.x, r.y, r.width, r.height],
          style: Object.fromEntries(
            props.map((p) => [p, s.getPropertyValue(p)]),
          ),
        },
        ...Array.from(e.children).flatMap((c, i) => walk(c, `${path}/${i}`)),
      ];
    };
    return walk(document.body, "0");
  }, properties);
  return {
    nodes,
    meta: {
      artboard: "tracks-pane/default",
      state: "default",
      viewport: { width: 1280, height: 800, dpr: 1 },
      file: input,
      designHead: head.hash,
      htmlSha256,
      binding: "chain-head",
      tokens: { "brand/500": "#0a64c8", "space/4": "16px" },
    },
    screenshot: await page.screenshot(),
  };
}
const baseline = await capture();
await writeFile(`${out}/design.png`, baseline.screenshot);
// Add isolated probes over the real baked board. Absolute boxes prevent cascading layout drifts.
await page.evaluate(() => {
  const e = document.createElement("div");
  e.id = "probes";
  e.innerHTML =
    '<div data-fdn-id="probe-padding" style="position:absolute;left:1000px;top:30px;width:80px;height:30px;box-sizing:border-box;background:rgb(240,240,240);padding-left:16px"></div><div data-fdn-id="probe-color" style="position:absolute;left:1000px;top:100px;width:80px;height:30px;background:rgb(10,100,200)"></div><div data-fdn-id="probe-remove" style="position:absolute;left:1000px;top:170px;width:80px;height:30px;background:rgb(100,200,10)"></div>';
  document.body.append(e);
});
const design = await capture();
for (const [name, c] of [["design-capture", design]] as const) {
  const dir = `${out}/${name}`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/dom.json`, JSON.stringify({ nodes: c.nodes }));
  await writeFile(`${dir}/meta.json`, JSON.stringify(c.meta));
  await writeFile(`${dir}/screenshot.png`, c.screenshot);
}
await writeFile(`${out}/design.png`, design.screenshot);
const results = [];
for (const scenario of [
  "unchanged",
  "padding",
  "colour",
  "remove",
  "strip-ids",
  "no-id-padding",
  "no-id-colour",
  "no-id-remove",
  "wrapper",
  "geometry",
  "text",
  "original-padding",
  "original-colour",
  "original-text",
]) {
  const saved = await page.content();
  if (scenario === "padding" || scenario === "no-id-padding")
    await page
      .locator('[data-fdn-id="probe-padding"]')
      .evaluate((e) => ((e as HTMLElement).style.paddingLeft = "12px"));
  if (scenario === "colour" || scenario === "no-id-colour")
    await page
      .locator('[data-fdn-id="probe-color"]')
      .evaluate(
        (e) => ((e as HTMLElement).style.backgroundColor = "rgb(200, 10, 100)"),
      );
  if (scenario === "remove" || scenario === "no-id-remove")
    await page
      .locator('[data-fdn-id="probe-remove"]')
      .evaluate((e) => e.remove());
  if (scenario === "original-padding")
    await page
      .locator('[data-fdn-id="n92"]')
      .evaluate((e) => ((e as HTMLElement).style.paddingLeft = "4px"));
  if (scenario === "original-colour")
    await page
      .locator('[data-fdn-id="n92"]')
      .evaluate((e) => ((e as HTMLElement).style.color = "rgb(200, 10, 100)"));
  if (scenario === "original-text")
    await page
      .locator('[data-fdn-id="n92"]')
      .evaluate((e) => (e.textContent = "Altered Tracks heading"));
  if (scenario === "geometry")
    await page
      .locator('[data-fdn-id="probe-padding"]')
      .evaluate((e) => ((e as HTMLElement).style.left = "1005px"));
  if (scenario === "text")
    await page
      .locator('[data-fdn-id="probe-padding"]')
      .evaluate((e) => (e.textContent = "Injected"));
  if (scenario === "wrapper")
    await page.locator("#probes").evaluate((e) => {
      const w = document.createElement("div");
      w.style.cssText = "width:1280px;height:800px";
      e.parentElement!.insertBefore(w, e);
      w.append(e);
    });
  if (scenario === "strip-ids" || scenario.startsWith("no-id-"))
    await page.evaluate(() =>
      document
        .querySelectorAll("[data-fdn-id]")
        .forEach((e) => e.removeAttribute("data-fdn-id")),
    );
  const code = await capture(),
    r = compare(design, code);
  if (scenario === "original-colour") {
    const dir = `${out}/code-color-capture`;
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/dom.json`, JSON.stringify({ nodes: code.nodes }));
    await writeFile(`${dir}/meta.json`, JSON.stringify(code.meta));
    await writeFile(`${dir}/screenshot.png`, code.screenshot);
  }
  const expected = scenario.endsWith("padding")
    ? "padding-left"
    : scenario.endsWith("colour")
      ? scenario.startsWith("original-")
        ? "color"
        : "background-color"
      : scenario.endsWith("remove")
        ? "node"
        : scenario === "geometry"
          ? "x"
          : scenario.endsWith("text")
            ? "text"
            : null;
  const tp = r.report.drifts.filter(
    (d) =>
      d.property === expected &&
      d.designNode ===
        (scenario.startsWith("original-")
          ? "n92"
          : `probe-${scenario.endsWith("colour") ? "color" : scenario.endsWith("remove") ? "remove" : "padding"}`),
  ).length;
  const fp = r.report.drifts.length - tp,
    fn = expected ? 1 - tp : 0;
  results.push({
    scenario,
    expected: expected ? 1 : 0,
    found: r.report.drifts.length,
    tp,
    fp,
    fn,
    precision: tp + fp ? tp / (tp + fp) : 1,
    recall: tp + fn ? tp / (tp + fn) : 1,
    pixelRatio: r.report.pixels.diffRatio,
    ms: r.report.timingsMs.compare,
  });
  const { matches, reportHash, ...summary } = r.report;
  await writeFile(
    `${out}/${scenario}.json`,
    JSON.stringify(
      {
        ...summary,
        matchCounts: {
          id: matches.filter((m) => m.kind === "id").length,
          heuristic: matches.filter((m) => m.kind === "heuristic").length,
        },
      },
      null,
      2,
    ),
  );
  await writeFile(`${out}/${scenario}-diff.png`, r.diff);
  if (scenario === "padding" || scenario === "no-id-padding")
    await writeFile(`${out}/mutated.png`, code.screenshot);
  await page.setContent(saved);
}
await browser.close();
await writeFile(
  `${out}/measurements.json`,
  JSON.stringify(results, null, 2) + "\n",
);
console.table(results);
if (results.some((r) => r.fp || r.fn)) process.exitCode = 1;
