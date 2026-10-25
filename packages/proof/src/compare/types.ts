export type Box = [number, number, number, number];
export interface CaptureNode {
  visibility?: {
    eligible: boolean;
    interactive?: boolean;
    clips: {path: string; box: number[]; x: boolean; y: boolean; scrollX: boolean; scrollY: boolean; pan?: boolean}[];
  };
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
export interface Defect {
  id: string;
  layer: { design?: string; code?: string };
  kind: Drift["kind"];
  classification: "product" | "environment" | "uncertain";
  cause: string;
  findings: string[];
  summary: string;
  offscreen?: {box: Box; frame: number[]; viewport?: number[]; elements: string[]; clips: NonNullable<CaptureNode["visibility"]>["clips"]};
  accepted?: { entryId: string; reason: string };
}
export interface Match {
  design: CaptureNode;
  code: CaptureNode;
  kind: "id" | "heuristic";
  confidence: number;
  uncertain?: true;
  reason?: string;
  wrappers?: { design: string[]; code: string[] };
}
