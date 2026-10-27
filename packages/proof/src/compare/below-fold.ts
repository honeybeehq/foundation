import type {CaptureNode,Match} from './types.ts';
const under=(n:CaptureNode,p:CaptureNode)=>n.path.startsWith(p.path+'/');
/** Supplemental correspondence for content clipped out of the ordinary image.
 * Unique copy establishes identity; nearest multi-anchor card boundaries may
 * then expose width/spacing differences. No repeated label is an identity. */
export function belowFoldMatches(design:CaptureNode[],code:CaptureNode[],visible:Match[]):Match[] {
 const usedD=new Set(visible.map(m=>m.design)),usedC=new Set(visible.map(m=>m.code));
 const unique=(nodes:CaptureNode[])=> {
  const map=new Map<string,CaptureNode[]>();
  for(const n of nodes) if(n.text?.trim()) {const t=n.text.trim();map.set(t,[...(map.get(t)??[]),n]);}
  return new Map([...map].filter(([,ns])=>ns.length===1).map(([t,ns])=>[t,ns[0]!]));
 };
 const dl=unique(design),cl=unique(code),result:Match[]=[];
 for(const [text,a] of dl) {
  const b=cl.get(text);
  if(!b || usedD.has(a) || usedC.has(b) || !a.visibility?.eligible || !b.visibility?.eligible ||
    [a,b].some(n=>n.visibility!.clips.some(c=>c.scrollX || c.scrollY))) continue;
  const parent=visible.filter(m=>!m.uncertain && under(a,m.design) && under(b,m.code)).sort((x,y)=>y.design.path.length-x.design.path.length)[0];
  if(!parent) continue;
  result.push({design:a,code:b,kind:'heuristic',confidence:0.7});usedD.add(a);usedC.add(b);
 }
 for(const pair of [...result]) {
  const left=design.filter(n=>n.path!=="0" && !usedD.has(n)&&under(pair.design,n)).sort((a,b)=>b.path.length-a.path.length);
  const right=code.filter(n=>n.path!=="0" && !usedC.has(n)&&under(pair.code,n)).sort((a,b)=>b.path.length-a.path.length);
  for(const a of left) {
   const anchors=result.filter(m=>under(m.design,a) && m.design.text?.trim());
   if(anchors.length<2) continue;
   const b=right.find(n=>anchors.every(m=>under(m.code,n)) &&
     result.filter(m=>under(m.code,n)&&m.code.text?.trim()).length===anchors.length);
   if(!b) continue;
   // Only the nearest shared content boundary; broad enclosing regions do not
   // become additional causes for the same moved card.
   result.push({design:a,code:b,kind:'heuristic',confidence:0.7});usedD.add(a);usedC.add(b);break;
  }
 }
 return result;
}
