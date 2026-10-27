import type {CaptureNode,Match} from './types.ts';
const under=(n:CaptureNode,p:CaptureNode)=>n===p || n.path.startsWith(p.path+'/');
/** Repeated sample collections with substantially different content. Geometry
 * and styling are deliberately NOT owned by these regions. Capture data alone
 * cannot tell whether a registry change is a product defect or fixture data. */
export function changedCollections(design:CaptureNode[],code:CaptureNode[],matches:Match[]) {
 const contexts=(nodes:CaptureNode[])=> {
  const result=new Map<string,Set<string>>();
  for(const n of nodes) if(n.text?.trim()) {
   const parts=n.path.split('/');
   for(let i=1;i<=parts.length;i++) {
    const path=parts.slice(0,i).join('/');
    if(!result.has(path)) result.set(path,new Set());
    result.get(path)!.add(n.text.trim());
   }
  }
  return result;
 };
 const dt=contexts(design),ct=contexts(code);
 const texts=(nodes:CaptureNode[],p:CaptureNode)=>(nodes===design?dt:ct).get(p.path) ?? new Set<string>();
 const repeated=(nodes:CaptureNode[])=> {
  const counts=new Map<string,number>();
  for(const n of nodes) if(texts(nodes,n).size>0) {
   const p=n.path.slice(0,n.path.lastIndexOf('/'));
   counts.set(p,(counts.get(p)??0)+1);
  }
  return nodes.filter(p=>(counts.get(p.path)??0)>=3);
 };
 const pairs:{design:CaptureNode;code:CaptureNode;score:number}[]=[];
 for(const a of repeated(design)) for(const b of repeated(code)) {
  const parent=matches.filter(m=>m.design!==a && m.code!==b && under(a,m.design) && under(b,m.code)).sort((x,y)=>y.design.path.length-x.design.path.length)[0];
  if(!parent) continue;
  // Require the same immediate collection slot beneath an established boundary.
  const slot=(n:CaptureNode,p:CaptureNode)=>n.path.slice(p.path.length+1).split('/')[0];
  if(slot(a,parent.design)!==slot(b,parent.code)) continue;
  const left=texts(design,a),right=texts(code,b),shared=[...left].filter(t=>right.has(t)).length;
  const dice=2*shared/(left.size+right.size);
  if(shared<2 || dice>=0.65 || dice<0.05) continue;
  pairs.push({design:a,code:b,score:dice});
 }
 return pairs.filter(p=>!pairs.some(q=>q!==p && under(p.design,q.design)&&under(p.code,q.code) && (p.design!==q.design || p.code!==q.code)))
   .sort((a,b)=>b.score-a.score);
}
