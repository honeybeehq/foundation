import { beforeAll, describe, expect, it } from "vitest";
import { compare, readCapture } from "./index.ts";
import type { Capture } from "./types.ts";
let base: Capture;
beforeAll(async () => {
  const capture = await readCapture(
    "packages/proof/fixtures/sample-reports/empty/design-capture",
  );
  base = {
    ...capture,
    meta: {
      ...capture.meta,
      fontPolicy: {
        sans: "Pinned Sans",
        mono: "Pinned Mono",
        serif: "Pinned Serif",
        fallback: "Pinned Symbols",
        requireCustomFonts: true,
      },
      fontAssets: [
        {
          family: "Pinned Mono",
          weight: "400",
          sha256: "a".repeat(64),
          format: "truetype",
          postScriptName: "PinnedMono",
        },
      ],
      platformFonts: [
        {
          familyName: "Pinned Mono",
          postScriptName: "PinnedMono",
          isCustomFont: true,
          glyphCount: 1,
        },
      ],
      browserVersion: "151.0.7922.34",
      platform: "linux",
      rendererSourceHash: "b".repeat(64),
    },
  };
});
const withMeta = (meta: Record<string, unknown>): Capture => ({
  ...base,
  meta: { ...base.meta, ...meta },
});
describe("pinned-font capture boundary", () => {
  it("accepts an audited unchanged control", () =>
    expect(compare(base, base).report.verdict).toBe("match"));
  it("rejects actual system glyph fallback despite equal pixels and declared family", () => {
    const code = withMeta({
      platformFonts: [
        {
          familyName: "WenQuanYi Zen Hei Mono",
          postScriptName: "WenQuanYiZenHeiMono",
          isCustomFont: false,
          glyphCount: 33,
        },
      ],
    });
    const r = compare(base, code).report;
    expect(r.verdict).toBe("not-provable");
    expect(r.reason).toMatch(/font/i);
  });
  it("rejects missing actual glyph inventory", () =>
    expect(compare(base, withMeta({ platformFonts: [] })).report.verdict).toBe(
      "not-provable",
    ));
  it("rejects missing asset hashes", () =>
    expect(
      compare(
        base,
        withMeta({ fontAssets: [{ family: "Pinned Mono", weight: "400" }] }),
      ).report.verdict,
    ).toBe("not-provable"));
  it("rejects unequal declared font bytes across the pair", () =>
    expect(
      compare(
        base,
        withMeta({
          fontAssets: [{ ...base.meta.fontAssets[0], sha256: "c".repeat(64) }],
        }),
      ).report.verdict,
    ).toBe("not-provable"));
});

it("carries the reviewed links font environment into verification policy", async () => {
  const { policyFromLinks } = await import("../report/policy.ts");
  const policy = policyFromLinks({
    designFile: "design.fdn.html",
    viteConfig: "vite.ts",
    harness: "harness.ts",
    artboards: [
      {
        id: "board",
        component: "view#View",
        designNode: "root",
        viewport: { width: 100, height: 100, dpr: 1 },
        components: [],
        states: [
          { name: "default", fixture: "default", designState: "default" },
        ],
      },
    ],
    ...base.meta,
    schema: "fdn-links/0",
    fonts: base.meta.fontAssets.map((font: any) => ({
      ...font,
      path: "fixture.ttf",
    })),
  });
  expect(policy).toHaveProperty(
    "captureEnvironment.browserVersion",
    "151.0.7922.34",
  );
});
