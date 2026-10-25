import { hash } from './canonical.ts';
import type { Capture, CaptureNode, Defect, Match } from './types.ts';
const id = (n: CaptureNode) => n.fdnId || n.path;
const within = (n: CaptureNode, p: CaptureNode) => n.path === p.path || n.path.startsWith(p.path + '/');
const exceeds = (b: number[], clip: number[], x = true, y = true) =>
  (x && (b[0]! < clip[0]! - 1 || b[0]! + b[2]! > clip[0]! + clip[2]! + 1)) ||
  (y && (b[1]! < clip[1]! - 1 || b[1]! + b[3]! > clip[1]! + clip[3]! + 1));

/** Independent of the frozen visible-node matcher; uses identity/text only for exemptions. */
export function offscreenDefects(design: Capture, code: Capture, matches: Match[]): Defect[] {
  const frame = (c: Capture): number[] => [0, 0, c.meta.frame?.width ?? c.nodes[0]?.box[2] ?? 0, c.meta.frame?.height ?? c.nodes[0]?.box[3] ?? 0];
  const outside = (n: CaptureNode, c: Capture) => exceeds(n.box, frame(c)) || n.visibility?.clips.some(a => exceeds(n.box, a.box, a.x, a.y));
  const counterpart = (n: CaptureNode) => {
    const ids = n.fdnId ? design.nodes.filter(d => d.fdnId === n.fdnId) : [];
    const same = ids.length === 1 ? ids : design.nodes.filter(d => n.text?.trim() && d.text?.trim() === n.text.trim() && d.tag === n.tag);
    const unchanged = design.nodes.find(d => d.path === n.path && d.tag === n.tag && d.text === n.text && d.box.every((v,i) => Math.abs(v-n.box[i]!) <= 1));
    if (unchanged) return unchanged;
    return same.length === 1 ? same[0] : matches.find(m => !m.uncertain && m.code.path === n.path)?.design;
  };
  const intended = (n: CaptureNode) => {
    const d = counterpart(n);
    if (!d || !outside(d, design)) return false;
    // A hidden/ellipsis counterpart is also intentional. For scroll overflow,
    // require corresponding content AND corresponding scroll ancestors/axes.
    const scrolls = n.visibility!.clips.filter(c => (c.scrollX || c.scrollY) && exceeds(n.box, c.box, c.x, c.y));
    return scrolls.every(c => {
      const ancestor = code.nodes.find(a => a.path === c.path);
      const da = ancestor && counterpart(ancestor);
      return !!da && d.visibility?.clips.some(a => a.path === da.path && (!c.scrollX || a.scrollX) && (!c.scrollY || a.scrollY));
    });
  };
  const label = (n: CaptureNode) => code.nodes.filter(c => c.visibility?.eligible && within(c,n)).map(c => c.name || c.text || c.role || c.tag).join(' · ');
  const bad = code.nodes.filter(n => n.visibility?.eligible && outside(n, code) && !intended(n));
  // Collapse only a wholly affected subtree whose own box is outside/clipped.
  // Never merge unrelated clipped siblings through an in-frame pane/root.
  const roots = bad.map(n => code.nodes.filter(p => p.path !== '0' && within(n, p) && outside(p, code) &&
    code.nodes.filter(c => c.visibility?.eligible && within(c, p)).every(c => bad.includes(c)))
    .sort((a,b) => a.path.length - b.path.length)[0] ?? n);
  return [...new Map(roots.map(n => [n.path, n])).values()].filter(n => !roots.some(p => p !== n && within(n,p))).map(n => ({
    id: 'def-' + hash({layer:{code:id(n)},kind:'layout',cause:'offscreen'}).slice(0,20),
    layer: {code:id(n)}, kind:'layout', cause:'offscreen', classification:'product', findings:[],
    summary: `rendered outside the visible pane: ${label(n) || n.fdnId || n.tag}`,
    offscreen: {box:n.box,frame:frame(code),elements:bad.filter(c => within(c,n)).map(c => c.path),clips:bad.find(c => within(c,n))!.visibility!.clips},
  }));
}
