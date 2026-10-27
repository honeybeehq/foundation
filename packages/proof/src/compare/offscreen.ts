import { hash } from './canonical.ts';
import type { Capture, CaptureNode, Defect, Match } from './types.ts';
const interactive = (n: CaptureNode) => n.visibility?.interactive ?? (/^(button|input|select|textarea|a|summary)$/.test(n.tag) || /^(button|link|textbox|checkbox|radio|switch|combobox|slider|spinbutton|menuitem|option|tab)$/.test(n.role ?? ''));
const within = (n: CaptureNode, p: CaptureNode) => n.path === p.path || n.path.startsWith(p.path + '/');
const exceeds = (b: number[], clip: number[], x = true, y = true) =>
  (x && (b[0]! < clip[0]! - 1 || b[0]! + b[2]! > clip[0]! + clip[2]! + 1)) ||
  (y && (b[1]! < clip[1]! - 1 || b[1]! + b[3]! > clip[1]! + clip[3]! + 1));

/** Independent of the frozen visible-node matcher; uses identity/text only for exemptions. */
export function offscreenDefects(design: Capture, code: Capture, matches: Match[]): Defect[] {
  const frame = (c: Capture): number[] => [0, 0, c.meta.frame?.width ?? c.nodes[0]?.box[2] ?? 0, c.meta.frame?.height ?? c.nodes[0]?.box[3] ?? 0];
  const viewport = (c: Capture): number[] | undefined => c.meta.extent?.viewport ?? (c.meta.viewport ? [0,0,c.meta.viewport.width,c.meta.viewport.height] : undefined);
  const outside = (n: CaptureNode, c: Capture) => exceeds(n.box, frame(c)) || (viewport(c) && exceeds(n.box,viewport(c)!)) || n.visibility?.clips.some(a => exceeds(n.box, a.box, a.x, a.y));
  const counterpart = (n: CaptureNode) => {
    const ids = n.fdnId ? design.nodes.filter(d => d.fdnId === n.fdnId) : [];
    const same = ids.length === 1 ? ids : design.nodes.filter(d => n.text?.trim() && d.text?.trim() === n.text.trim() && interactive(d) === interactive(n));
    const controls=code.nodes.filter(c=>within(c,n) && interactive(c) && c.text?.trim() &&
      code.nodes.filter(x=>x.text===c.text).length===1 && design.nodes.filter(x=>x.text===c.text).length===1);
    if(controls.length>=2) {
      const root=design.nodes.filter(p=>controls.every(c=>design.nodes.some(d=>within(d,p) && d.text===c.text)))
        .sort((a,b)=>b.path.length-a.path.length)[0];
      if(root) return root;
    }
    const unchanged = design.nodes.find(d => d.path === n.path && d.tag === n.tag && d.text === n.text && d.box.every((v,i) => Math.abs(v-n.box[i]!) <= 1));
    if (unchanged) return unchanged;
    if (same.length > 1) {
      // Repeated labels inherit identity from the nearest uniquely named card.
      // Never use a bare repeated word as a global identity.
      const contexts=code.nodes.filter(p=>within(n,p)).sort((a,b)=>b.path.length-a.path.length);
      for(const p of contexts) {
        const anchors=code.nodes.filter(c=>within(c,p) && c.text?.trim() && c.text!==n.text &&
          code.nodes.filter(x=>x.text===c.text).length===1 && design.nodes.filter(x=>x.text===c.text).length===1);
        if(!anchors.length) continue;
        const roots=design.nodes.filter(root=>anchors.every(anchor=>within(design.nodes.find(x=>x.text===anchor.text)!,root)))
          .sort((a,b)=>b.path.length-a.path.length);
        for(const root of roots) {
          const candidates=same.filter(d=>within(d,root));
          if(candidates.length===1) return candidates[0];
          if(candidates.length>1) break;
        }
      }
    }
    return same.length === 1 ? same[0] : matches.find(m => !m.uncertain && m.code.path === n.path)?.design;
  };
  const intended = (n: CaptureNode) => {
    const d = counterpart(n);
    if (!d || !outside(d, design)) return false;
    // A hidden/ellipsis counterpart is also intentional. For scroll overflow,
    // require corresponding content AND corresponding scroll ancestors/axes.
    const scrolls = n.visibility!.clips.filter(c => (c.scrollX || c.scrollY) && exceeds(n.box, c.box, c.x, c.y));
    return scrolls.every(c => {
      if ((c.scrollX || c.scrollY) && outside(d, design)) return true;
      const ancestor = code.nodes.find(a => a.path === c.path);
      const da = ancestor && counterpart(ancestor);
      return !!da && d.visibility?.clips.some(a => a.path === da.path && (!c.scrollX || a.scrollX) && (!c.scrollY || a.scrollY));
    });
  };
  const label = (n: CaptureNode) => code.nodes.filter(c => c.visibility?.eligible && within(c,n)).map(c => c.name || c.text || c.role || c.tag).join(' · ');
  // Content beyond an in-frame scrolling viewport is reachable by scrolling.
  // A hidden outer clip must not be mistaken for reachability when the scroll
  // viewport itself escapes it. Pan remains unsupported rather than inferred.
  const reachable = (n: CaptureNode) => n.visibility!.clips.some(clip => {
    if (!clip.scrollX && !clip.scrollY) return false;
    const scroller=code.nodes.find(a => a.path===clip.path);
    if (!scroller || outside(scroller,code)) return false;
    return !exceeds(n.box,clip.box,!clip.scrollX,!clip.scrollY);
  });
  const bad = code.nodes.filter(n => n.visibility?.eligible && outside(n, code) && !intended(n) && !reachable(n));
  // Collapse only a wholly affected subtree whose own box is outside/clipped.
  // Never merge unrelated clipped siblings through an in-frame pane/root.
  const roots = bad.map(n => code.nodes.filter(p => p.path !== '0' && within(n, p) && outside(p, code) &&
    code.nodes.filter(c => c.visibility?.eligible && within(c, p)).every(c => bad.includes(c)))
    .sort((a,b) => a.path.length - b.path.length)[0] ?? n);
  const id = (n: CaptureNode) => n.fdnId && code.nodes.filter(c=>c.fdnId===n.fdnId).length===1 ? n.fdnId : n.path;
  return [...new Map(roots.map(n => [n.path, n])).values()].filter(n => !roots.some(p => p !== n && within(n,p))).map(n => ({
    id: 'def-' + hash({layer:{code:id(n)},path:n.path,kind:'layout',cause:'offscreen'}).slice(0,20),
    layer: {...(counterpart(n) ? {design:counterpart(n)!.fdnId || counterpart(n)!.path}:{}),code:id(n)}, kind:'layout', cause:'offscreen', classification:'product', findings:[],
    summary: `rendered outside the visible pane: ${label(n) || n.fdnId || n.tag}`,
    offscreen: {box:n.box,frame:frame(code),viewport:viewport(code),elements:bad.filter(c => within(c,n)).map(c => c.path),clips:bad.find(c => within(c,n))!.visibility!.clips},
  }));
}
