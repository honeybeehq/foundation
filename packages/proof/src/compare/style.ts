export const properties = [
  "color",
  "background-color",
  "background-image",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "row-gap",
  "column-gap",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "opacity",
  "box-shadow",
  "text-shadow",
  "display",
  "align-items",
  "justify-content",
  "flex-direction",
  "visibility",
  "position",
  "box-sizing",
  "overflow-x",
  "overflow-y",
  "font-style",
  "text-decoration-line",
  "white-space",
  "gap",
  "flex-grow",
  "flex-shrink",
];
export function rgba(s: string): number[] | null {
  if (s === "transparent") return [0, 0, 0, 0];
  if (/^#[\da-f]{3,8}$/i.test(s)) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    ];
  }
  if (/^rgba?\(/.test(s)) {
    const n = s.match(/[\d.]+/g)?.map(Number);
    if (n && (n.length === 3 || n.length === 4))
      return [...n.slice(0, 3), n[3] ?? 1];
  }
  return null;
}
function lab(rgb: number[]) {
  const c = rgb.slice(0, 3).map((v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = c as [number, number, number];
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const x = f((r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047),
    y = f(r * 0.2126729 + g * 0.7151522 + b * 0.072175),
    z = f((r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function deltaE(a: string, b: string): number | null {
  const x = rgba(a),
    y = rgba(b);
  if (!x || !y) return null;
  const l = lab(x),
    m = lab(y);
  return Math.hypot(...l.map((v, i) => v - m[i]!), 100 * (x[3]! - y[3]!));
}
export function equal(a: string, b: string, px: number, color: number) {
  if (a === b) return true;
  const de = deltaE(a, b);
  if (de !== null) return de <= color;
  if (/^-?[\d.]+px$/.test(a) && /^-?[\d.]+px$/.test(b))
    return Math.abs(parseFloat(a) - parseFloat(b)) <= px;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
export function token(
  value: string,
  tokens: Record<string, string>,
): string | null {
  return (
    Object.keys(tokens)
      .sort()
      .find((k) => equal(value, tokens[k]!, 0, 0.01)) ?? null
  );
}
