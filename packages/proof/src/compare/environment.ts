import { canonical, hash } from "./canonical.ts";
import type { Capture } from "./types.ts";
export interface FontPolicy {
  sans: string;
  mono: string;
  serif: string;
  fallback: string;
  requireCustomFonts: true;
}
export interface FontAsset {
  family: string;
  weight: string;
  format: string;
  sha256: string;
  postScriptName: string;
}
export interface CaptureEnvironmentPolicy {
  browserVersion: string;
  platform: string;
  fontPolicy: FontPolicy;
  fontAssets: FontAsset[];
  rendererSourceHash?: string;
}
const digest = (v: unknown) =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function fontAssets(value: unknown): FontAsset[] {
  if (!Array.isArray(value) || !value.length)
    throw Error("Font asset inventory is missing");
  return value
    .map((a) => {
      if (
        !a ||
        typeof a.family !== "string" ||
        typeof a.weight !== "string" ||
        !digest(a.sha256) ||
        typeof a.postScriptName !== "string" ||
        !a.postScriptName
      )
        throw Error("Font asset identity or SHA256 is missing");
      return {
        family: a.family,
        weight: a.weight,
        format: a.format ?? "woff2",
        sha256: a.sha256,
        postScriptName: a.postScriptName,
      };
    })
    .sort((a, b) =>
      canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0,
    );
}
export function fontPolicy(value: unknown): FontPolicy {
  const p = value as FontPolicy;
  if (
    !p ||
    p.requireCustomFonts !== true ||
    ["sans", "mono", "serif", "fallback"].some(
      (k) =>
        typeof (p as unknown as Record<string, unknown>)[k] !== "string" ||
        !(p as unknown as Record<string, string>)[k],
    )
  )
    throw Error("Pinned font policy is missing or incomplete");
  return p;
}
export function captureEnvironment(
  meta: Record<string, any>,
): CaptureEnvironmentPolicy {
  const policy = fontPolicy(meta.fontPolicy),
    assets = fontAssets(meta.fontAssets);
  if (
    typeof meta.browserVersion !== "string" ||
    !meta.browserVersion ||
    typeof meta.platform !== "string" ||
    !meta.platform
  )
    throw Error("Pinned browser/platform is missing");
  if (!digest(meta.rendererSourceHash))
    throw Error("Renderer source hash is missing");
  return {
    browserVersion: meta.browserVersion,
    platform: meta.platform,
    fontPolicy: policy,
    fontAssets: assets,
    rendererSourceHash: meta.rendererSourceHash,
  };
}
export function pinnedFontIssues(capture: Capture): string[] {
  try {
    const env = captureEnvironment(capture.meta),
      glyphs = capture.meta.platformFonts;
    if (
      !Array.isArray(glyphs) ||
      (!glyphs.length && capture.nodes.some((n) => n.text?.trim()))
    )
      return ["Actual rendered font glyph inventory is missing"];
    if (
      capture.nodes.some(
        (n) =>
          (n.text?.trim() ||
            ["input", "button", "select", "textarea", "svg"].includes(n.tag)) &&
          (typeof n.authoredFontFamily !== "string" || !n.authoredFontFamily),
      )
    )
      return [
        "Authored font-family provenance before normalization is missing",
      ];
    for (const font of glyphs) {
      if (!Number.isInteger(font.glyphCount) || font.glyphCount < 0)
        return ["Actual rendered font glyph inventory is invalid"];
      if (font.glyphCount === 0) continue;
      if (font.isCustomFont !== true)
        return [
          "Actual rendered font uses system fallback: " + font.familyName,
        ];
      if (!env.fontAssets.some((a) => a.postScriptName === font.postScriptName))
        return [
          "Actual rendered font is outside the declared hashed font assets: " +
            font.postScriptName,
        ];
    }
    return [];
  } catch (e) {
    return [e instanceof Error ? e.message : String(e)];
  }
}
export function pairEnvironmentIssues(
  design: Capture,
  code: Capture,
): string[] {
  if (
    design.meta.fontPolicy?.requireCustomFonts !== true &&
    code.meta.fontPolicy?.requireCustomFonts !== true
  )
    return [];
  const errors = [...pinnedFontIssues(design), ...pinnedFontIssues(code)];
  if (errors.length) return errors;
  const d = captureEnvironment(design.meta),
    c = captureEnvironment(code.meta);
  if (canonical(d) !== canonical(c))
    return [
      "Capture font assets, font policy, browser/platform or renderer source fingerprints differ",
    ];
  return [];
}
export function environmentMatches(
  meta: Record<string, any>,
  expected: CaptureEnvironmentPolicy,
): boolean {
  try {
    const actual = captureEnvironment(meta);
    const { rendererSourceHash, ...portable } = actual;
    const { rendererSourceHash: expectedRenderer, ...expectedPortable } =
      expected;
    return (
      canonical(portable) ===
        canonical({
          ...expectedPortable,
          fontAssets: fontAssets(expected.fontAssets),
        }) &&
      (!expectedRenderer || rendererSourceHash === expectedRenderer)
    );
  } catch {
    return false;
  }
}
export const fontBundleHash = (assets: unknown) => hash(fontAssets(assets));

export function environmentFromLinks(
  links: Record<string, any>,
): CaptureEnvironmentPolicy | undefined {
  if (links.fontPolicy === undefined) return undefined;
  const policy = fontPolicy(links.fontPolicy),
    assets = fontAssets(links.fonts);
  if (
    typeof links.browserVersion !== "string" ||
    !links.browserVersion ||
    typeof links.platform !== "string" ||
    !links.platform
  )
    throw Error("Reviewed links must pin browser and platform for font policy");
  return {
    browserVersion: links.browserVersion,
    platform: links.platform,
    fontPolicy: policy,
    fontAssets: assets,
  };
}
