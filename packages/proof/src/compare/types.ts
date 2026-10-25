export type Box = [number, number, number, number];
export interface CaptureNode {
  path: string;
  tag: string;
  fdnId?: string | null;
  role?: string;
  name?: string;
  text?: string;
  box: Box;
  style: Record<string, string>;
  authoredFontFamily?: string;
  vars?: Record<string, string>;
}
export interface Capture {
  nodes: CaptureNode[];
  meta: Record<string, any>;
  screenshot: Buffer;
}
export interface Tolerances {
  pixelRatio: number;
  boxPx: number;
  colorDeltaE: number;
  stylePx: number;
  pixelThreshold: number;
}
export const defaults: Tolerances = {
  pixelRatio: 0.001,
  boxPx: 1,
  colorDeltaE: 1,
  stylePx: 1,
  pixelThreshold: 0.1,
};
export interface Drift {
  id: string;
  kind: "layout" | "style" | "token" | "text" | "missing" | "extra";
  designNode?: string;
  codeNode?: string;
  match?: "id" | "heuristic";
  confidence: number;
  property: string;
  design?: unknown;
  code?: unknown;
  rendered?: { design: string; code: string };
  token?: { design: string | null; code: string | null };
  designBox?: Box;
  codeBox?: Box;
}
export interface Match {
  design: CaptureNode;
  code: CaptureNode;
  kind: "id" | "heuristic";
  confidence: number;
}
