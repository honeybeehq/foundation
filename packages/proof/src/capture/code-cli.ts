import {captureFrames} from './frame.ts'
import { captureFullExtent } from "./extent.ts";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { readCapture, captureHash } from "../compare/index.ts";
import { chromium } from "playwright";
import { hash } from "../compare/canonical.ts";

import { collectDom, STYLE_PROPERTIES } from "./dom.js";
import { startCodeServer } from "./vite.js";
import type { Links } from "./types.js";
import { writePair, writeGallery } from "./gallery.js";
import { pinFontStacks, usedFonts } from "./fonts.js";

import { settleRoot } from "./settle.js";

const args = process.argv.slice(2);
const option = (key: string, fallback?: string) =>
  args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const repo = resolve(option("--code", ".")!);
const linksPath = resolve(repo, option("--links", ".foundation/links.json")!);
const out = resolve(option("--out", "captures")!);
const baseline = resolve(option("--baseline", ".foundation/baseline")!);
const toolHash = option("--tool-hash");
if (!toolHash || !/^[a-f0-9]{64}$/.test(toolHash))
  throw Error("--tool-hash requires the reviewed CLI tarball SHA256");
const started = performance.now();
const links = JSON.parse(await readFile(linksPath, "utf8")) as Links;
if (links.schema !== "fdn-links/0" || !links.artboards?.length)
  throw Error("Expected fdn-links/0 with artboards");
const fontAssets = await Promise.all(
  (links.fonts ?? []).map(async (font) => {
    const bytes = await readFile(resolve(repo, font.path));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (font.sha256 && font.sha256 !== sha256)
      throw new Error(`Font asset hash mismatch: ${font.path}`);
    return {
      ...font,
      sha256,
      css: `@font-face{font-family:${JSON.stringify(font.family)};font-weight:${font.weight};font-style:normal;src:url(data:font/${font.format === "truetype" ? "ttf" : "woff2"};base64,${bytes.toString("base64")}) format('${font.format ?? "woff2"}')}`,
    };
  }),
);
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repo,
  encoding: "utf8",
}).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], {
  cwd: repo,
  encoding: "utf8",
}).trim();
if (dirty && !args.includes("--allow-dirty"))
  throw new Error(
    "Code checkout is dirty; commit it or use --allow-dirty for exploratory captures",
  );
const target = await startCodeServer(repo, links);
const first = links.artboards[0]!,
  firstState = first.states[0]!;
const sample = await readCapture(
  join(
    baseline,
    first.id,
    firstState.name,
    `${first.viewport.width}x${first.viewport.height}@${first.viewport.dpr}`,
    "design",
  ),
);
const DETERMINISM_FLAGS: string[] = sample.meta.flags;
const browser = await chromium.launch({
  headless: true,
  args: DETERMINISM_FLAGS,
});
const rendererCommit = toolHash,
  rendererDirty = false;
const provenance = { rendererSourceHash: toolHash, toolSha256: toolHash };
try {
  if (links.browserVersion && browser.version() !== links.browserVersion)
    throw new Error(
      `Browser mismatch: expected ${links.browserVersion}, got ${browser.version()}`,
    );
  if (links.platform && process.platform !== links.platform)
    throw new Error(
      `Platform mismatch: expected ${links.platform}, got ${process.platform}`,
    );
  let index = 0;
  const pairs: { path: string; state: string }[] = [];
  for (const { board, state } of target.entries) {
    const pairStart = performance.now();
    const design = await readCapture(
      join(
        baseline,
        board.id,
        state.name,
        `${board.viewport.width}x${board.viewport.height}@${board.viewport.dpr}`,
        "design",
      ),
    );
    if (design.meta.designHead !== links.designHead)
      throw Error(
        "Baseline design binding differs from links; regenerate baseline",
      );
    const {frame,hostFrame}=captureFrames(design.meta.frame,board.viewport,design.meta.designIsolation?.mode === 'in-place');
    const folder = join(
      out,
      board.id,
      state.name,
      `${board.viewport.width}x${board.viewport.height}@${board.viewport.dpr}`,
    );
    for (const side of ["code"] as const) {
      const captureStart = performance.now();
      const blocked: string[] = [];
      const errors: string[] = [];
      const context = await browser.newContext({
        viewport: {
          width: board.viewport.width,
          height: board.viewport.height,
        },
        deviceScaleFactor: board.viewport.dpr,
        colorScheme: "light",
        reducedMotion: "reduce",
        forcedColors: "none",
        timezoneId: "UTC",
        locale: "en-US",
        serviceWorkers: "block",
      });
      await context.addInitScript(() => {
        (window as any).__name = (fn: unknown) => fn;
        const pending = new Set<number>();
        const nativeSetTimeout = window.setTimeout.bind(window);
        const nativeClearTimeout = window.clearTimeout.bind(window);
        window.setTimeout = ((
          callback: any,
          delay?: number,
          ...params: any[]
        ) => {
          const id = nativeSetTimeout(() => {
            pending.delete(id);
            callback(...params);
          }, delay);
          pending.add(id);
          return id;
        }) as typeof window.setTimeout;
        window.clearTimeout = (id) => {
          pending.delete(Number(id));
          nativeClearTimeout(id);
        };
        Object.defineProperty(window, "__foundationPendingTimers", {
          get: () => pending.size,
        });
        const epoch = Date.parse("2026-07-31T12:00:00Z");
        const RealDate = Date;
        window.Date = new Proxy(RealDate, {
          construct: (target, args) =>
            args.length ? Reflect.construct(target, args) : new target(epoch),
          apply: () => new RealDate(epoch).toString(),
        });
        Date.now = () => epoch;
        let seed = 1;
        Math.random = () =>
          ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 0) /
          4294967296;
        Object.defineProperty(globalThis.performance, "now", {
          value: () => 0,
          configurable: true,
        });
        window.WebSocket = class {
          constructor() {
            throw new Error("Foundation: WebSocket blocked");
          }
        } as unknown as typeof WebSocket;
      });
      await context.route("**/*", async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const asset = [
          "document",
          "script",
          "stylesheet",
          "image",
          "font",
          "other",
        ].includes(req.resourceType());
        if (
          url.origin === new URL(target.url).origin &&
          req.method() === "GET" &&
          asset
        )
          await route.continue();
        else {
          blocked.push(req.url());
          await route.abort("blockedbyclient");
        }
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      let url = "foundation:baked";
      try {
        url = `${target.url}__foundation/${index}`;
        await page.goto(url);
        await page.waitForFunction(
          () =>
            (window as any).__foundationReady ||
            (window as any).__foundationError,
          undefined,
          { timeout: 60000 },
        );
        const error = await page.evaluate(
          () => (window as any).__foundationError,
        );
        if (error) throw new Error(error);
        await page.addStyleTag({
          content:
            fontAssets.map((font) => font.css).join("\n") +
            "\n*{animation:none!important;transition:none!important;caret-color:transparent!important} #foundation-root{width:100vw;height:100vh;overflow:hidden}",
        });
        await page.evaluate(() => document.fonts.ready);
        const fontSubstitutions = await pinFontStacks(page, links.fontPolicy);
        await page.addStyleTag({
          content: `#foundation-root{width:${hostFrame.width}px;height:${hostFrame.height}px}`,
        });
        await page.waitForFunction(
          () => (window as any).__foundationPendingTimers === 0,
          undefined,
          { timeout: 5000 },
        );
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        await settleRoot(page);
        const platformFonts = await usedFonts(
          page,
          links.fontPolicy?.requireCustomFonts ?? false,
          fontAssets
            .map((font) => font.postScriptName)
            .filter((name): name is string => Boolean(name)),
        );
        const dom = await collectDom(page, "#foundation-root");
        if (errors.length || blocked.length)
          throw new Error(JSON.stringify({ errors, blocked }));
        const fonts = await page.evaluate(() =>
          [
            ...new Set(
              Array.from(document.querySelectorAll("#foundation-root *")).map(
                (el) => getComputedStyle(el).fontFamily,
              ),
            ),
          ].sort(),
        );
        const tokens = await page.evaluate(() => {
          const css = getComputedStyle(document.documentElement);
          return Object.fromEntries(
            Array.from(css)
              .filter((k) => k.startsWith("--"))
              .sort()
              .map((k) => [k, css.getPropertyValue(k).trim()]),
          );
        });
        const destination = join(folder, side);
        await mkdir(destination, { recursive: true });
        await page.screenshot({
          path: join(destination, "screenshot.png"),
          animations: "disabled",
        });
        const fullExtent = await captureFullExtent(page, "#foundation-root", join(destination, "full-extent.png"));
        await writeFile(
          join(destination, "dom.json"),
          JSON.stringify(dom, null, 2) + "\n",
        );
        const meta = {
          schema: "fdn-capture/0",
          ...provenance,
          rendererCommit,
          rendererDirty,
          provable: state.provable !== false,
          ...(state.reason ? { reason: state.reason } : {}),
          source: side,
          artboard: board.id,
          state: state.name,
          viewport: board.viewport,
          extent: dom.extent, fullExtent,
          frame,
          url,
          fonts,
          fontPolicy: links.fontPolicy,
          fontSubstitutions,
          platformFonts,
          fontAssets: fontAssets.map(({ css, ...font }) => font),
          tokens,
          renderedAt: "2026-07-31T12:00:00.000Z",
          baselineCaptureHash: captureHash(design),
          repo: "honeybeehq/apiary",
          commit,
          dirty: Boolean(dirty),
          root: board.component,
          browserVersion: browser.version(),
          platform: process.platform,
          flags: DETERMINISM_FLAGS,
          styleProperties: STYLE_PROPERTIES,
          blocked,
          errors,
          timingsMs: { capture: Math.round(performance.now() - captureStart) },
        };
        await writeFile(
          join(destination, "meta.json"),
          JSON.stringify(meta, null, 2) + "\n",
        );
        console.log(
          `${board.id}/${state.name} ${side}: ${dom.nodes.length} nodes, ${meta.timingsMs.capture} ms`,
        );
      } finally {
        await page
          .evaluate(async () => {
            await (window as any).__foundationCleanup?.();
          })
          .catch(() => {});
        await context.close();
      }
    }

    pairs.push({ path: relative(out, folder), state: state.name });
    console.log(
      `PAIR ${folder} ${Math.round(performance.now() - pairStart)} ms`,
    );
    index++;
  }
} finally {
  await target.close();
  await browser.close();
}
console.log(
  `Captured ${target.entries.length} pairs in ${Math.round(performance.now() - started)} ms`,
);
