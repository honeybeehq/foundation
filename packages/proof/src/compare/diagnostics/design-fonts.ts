/** Design-only reproduction of cross-machine frame/font drift. No app checkout needed. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument, bakeDocument } from "../../../../engine/src/index.ts";
import {
  getBrowser,
  closeBrowser,
} from "../../../../engine/src/render/browser.ts";
import { collectDom } from "../../capture/dom.ts";
const source = "packages/proof/fixtures/design/tracks-pane.fdn.html";
const out =
  process.argv[2] ?? "packages/proof/src/compare/diagnostics/evidence";
await mkdir(out, { recursive: true });
const monoArg = process.argv.indexOf("--mono-file"),
  monoFile = monoArg >= 0 ? process.argv[monoArg + 1] : undefined;
const monoCss = monoFile
  ? `@font-face{font-family:DiagnosticMono;src:url(data:font/ttf;base64,${(await readFile(monoFile)).toString("base64")})}:root{--font-mono:DiagnosticMono}`
  : "";
const doc = parseDocument(await readFile(source, "utf8")).doc,
  browser = await getBrowser(),
  rows = [];
try {
  for (const state of ["track-selected", "proposal-pending"]) {
    const storedRoot = `packages/proof/fixtures/sample-captures/tracks-pane/${state}/1416x720@1/design`,
      stored = JSON.parse(
        await readFile(path.join(storedRoot, "dom.json"), "utf8"),
      ),
      meta = JSON.parse(
        await readFile(path.join(storedRoot, "meta.json"), "utf8"),
      );
    const page = await browser.newPage({
      viewport: { width: 1416, height: 720 },
      deviceScaleFactor: 1,
    });
    await page.evaluate("globalThis.__name=(f)=>f");
    await page.setContent(
      bakeDocument(doc, { state, includeNodeIds: true }).html,
    );
    await page.evaluate((id) => {
      const el = document.querySelector(`[data-fdn-id="${id}"]`);
      if (!el) throw Error("Missing design root " + id);
      const root = document.createElement("div");
      root.id = "foundation-root";
      root.append(el);
      document.body.replaceChildren(root);
      document.body.style.margin = "0";
    }, stored.nodes[1].fdnId);
    await page.addStyleTag({
      content:
        "#foundation-root{width:1416px;height:720px;overflow:hidden}*{animation:none!important;transition:none!important;caret-color:transparent!important}",
    });
    if (monoCss) await page.addStyleTag({ content: monoCss });
    await page.evaluate(() => document.fonts.ready);
    const dom = await collectDom(page, "#foundation-root"),
      frame = dom.nodes[1] as any;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const root = await cdp.send("DOM.getDocument");
    const textNodes = [];
    for (const node of (dom.nodes as any[]).filter((n) => n.text).slice(0, 6)) {
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: root.root.nodeId,
        selector: `[data-fdn-id="${node.fdnId}"]`,
      });
      const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", {
        nodeId,
      });
      const old = stored.nodes.find((n: any) => n.fdnId === node.fdnId);
      textNodes.push({
        fdnId: node.fdnId,
        text: node.text,
        style: {
          family: node.style["font-family"],
          size: node.style["font-size"],
          lineHeight: node.style["line-height"],
        },
        storedBox: old?.box,
        freshBox: node.box,
        platformFonts: fonts,
      });
    }
    rows.push({
      state,
      monoFile: monoFile ?? null,
      storedFrame: meta.frame,
      freshFrame: { width: frame.box[2], height: frame.box[3] },
      matches:
        meta.frame.width === frame.box[2] && meta.frame.height === frame.box[3],
      textNodes,
    });
    await page.close();
  }
} finally {
  await closeBrowser();
}
await writeFile(
  path.join(out, "design-fonts.json"),
  JSON.stringify(rows, null, 2) + "\n",
);
console.log(JSON.stringify(rows, null, 2));
if (process.argv.includes("--expect-stored") && rows.some((r) => !r.matches))
  process.exitCode = 1;
