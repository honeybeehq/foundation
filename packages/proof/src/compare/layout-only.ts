import type {CapturedLayoutRegion} from '../capture/layout-regions.ts';
import type {Capture,CaptureNode,Defect,Drift,Match,Tolerances} from './types.ts';
import {hash} from './canonical.ts';

export function layoutOnlyEvidence(design:Capture,code:Capture,t:Tolerances) {
 const drifts:Drift[]=[],defects:Defect[]=[],matches:Match[]=[];
 const templates:{region:string;root:{design:string;code:string};unit:{design:string;code:string};findings:string[];signature:string}[]=[];
 const coverage:{id:string;design:string|null;code:string|null;comparedItems:number;ignoredDesignItems:number;ignoredCodeItems:number}[]=[];
 const dm=design.meta.layoutOnlyRegions as CapturedLayoutRegion[]|undefined,cm=code.meta.layoutOnlyRegions as CapturedLayoutRegion[]|undefined;
 const fail=(reason:string)=>({drifts,defects,matches,coverage,reason:`layout-only not-provable: ${reason}`});
 if(!Array.isArray(dm) || !Array.isArray(cm) || !dm.length || !cm.length) return fail('capture lacks declared regions');
 if([...dm,...cm].some(r=>!r || typeof r.id!=='string' || (r.root!==null && typeof r.root!=='string') || r.items!==undefined && (!Array.isArray(r.items) || r.items.some(p=>typeof p!=='string')))) return fail('invalid region facts');
 if(new Set(dm.map(r=>r.id)).size!==dm.length || new Set(cm.map(r=>r.id)).size!==cm.length || dm.length!==cm.length || dm.some(a=>!cm.some(b=>a.id===b.id))) return fail('region declarations differ');
 const dp=new Map(design.nodes.map(n=>[n.path,n])),cp=new Map(code.nodes.map(n=>[n.path,n]));
 const id=(n:CaptureNode)=>n.fdnId || n.path;
 const add=(region:string,a:CaptureNode,b:CaptureNode,property:string,av:unknown,bv:unknown)=>{
  const d:Drift={id:`d${drifts.length+1}`,kind:'layout',property,designNode:id(a),codeNode:id(b),design:av,code:bv,designBox:a.box,codeBox:b.box,confidence:1};
  drifts.push(d);
  const cause=property==='order'?'layout:order':'layout:geometry';
  let group=defects.find(g=>g.cause===cause && g.layer.design===id(a) && g.layer.code===id(b));
  if(!group) {group={id:'def-'+hash({region,layer:{design:id(a),code:id(b)},cause}).slice(0,20),kind:'layout',classification:'product',cause,layer:{design:id(a),code:id(b)},findings:[],summary:`${cause} differs in ${region}`};defects.push(group);}
  group.findings.push(d.id);
 };
 const boxes=(region:string,a:CaptureNode,b:CaptureNode,ar?:CaptureNode,br?:CaptureNode)=>{
  matches.push({design:a,code:b,kind:'heuristic',confidence:1});
  a.box.forEach((value,i)=>{
   const av=value-(ar && i<2?ar.box[i]!:0),bv=b.box[i]!-(br && i<2?br.box[i]!:0);
   if(Math.abs(av-bv)>t.boxPx) add(region,a,b,['x','y','width','height'][i]!,av,bv);
  });
 };
 for(const a of dm) {
  const b=cm.find(r=>r.id===a.id)!;
  const ar=a.root?dp.get(a.root):undefined,br=b.root?cp.get(b.root):undefined;
  if(!ar || !br) return fail(`missing marker for ${a.id}`);
  if(Boolean(a.items)!==Boolean(b.items)) return fail(`repeat declaration differs for ${a.id}`);
  const left=(a.items??[]).map(p=>dp.get(p)),right=(b.items??[]).map(p=>cp.get(p));
  if(left.some(n=>!n) || right.some(n=>!n)) return fail(`missing repeated item facts for ${a.id}`);
  const parent=dm.filter(p=>p!==a && p.root && ar.path.startsWith(p.root+'/')).map(p=>({a:p,b:cm.find(q=>q.id===p.id)}))
    .filter(p=>p.b?.root && br.path.startsWith(p.b.root+'/')).sort((x,y)=>y.a.root!.length-x.a.root!.length)[0];
  boxes(a.id,ar,br,parent?dp.get(parent.a.root!):undefined,parent?cp.get(parent.b!.root!):undefined);
  const count=Math.min(left.length,right.length);
  coverage.push({id:a.id,design:a.root,code:b.root,comparedItems:count,ignoredDesignItems:left.length-count,ignoredCodeItems:right.length-count});
  if(a.items && Boolean(left.length)!==Boolean(right.length)) add(a.id,ar,br,'presence',left.length>0,right.length>0);
  const unique=(nodes:(CaptureNode|undefined)[],n:CaptureNode)=>!!n.fdnId && nodes.filter(x=>x?.fdnId===n.fdnId).length===1;
  const keyed=left.filter((n):n is CaptureNode=>!!n && unique(left,n) && right.some(x=>!!x && x.fdnId===n.fdnId && unique(right,x)));
  // Shared stable item ids retain semantic order; otherwise compare ordinal
  // template geometry, explicitly ignoring surplus data-dependent rows.
  if(keyed.length) {
   const sequence=keyed.map(n=>right.findIndex(x=>x?.fdnId===n.fdnId));
   if(sequence.some((v,i)=>i>0 && v<sequence[i-1]!)) add(a.id,ar,br,'order',keyed.map(id),sequence);
  }
  const pairs=keyed.map(n=>({a:n,b:right.find(x=>x?.fdnId===n.fdnId)!}));
  const restA=left.filter(n=>!pairs.some(p=>p.a===n)),restB=right.filter(n=>!pairs.some(p=>p.b===n));
  for(let i=0;i<Math.min(restA.length,restB.length);i++) pairs.push({a:restA[i]!,b:restB[i]!});
  for(const pair of pairs) {
   const start=drifts.length;boxes(a.id,pair.a,pair.b,ar,br);
   const changes=drifts.slice(start);
   if(changes.length) templates.push({region:a.id,root:{design:id(ar),code:id(br)},unit:{design:id(pair.a),code:id(pair.b)},findings:changes.map(d=>d.id),signature:changes.map(d=>`${d.property}:${Math.round((Number(d.code)-Number(d.design))/.05)}`).join('|')});
  }
 }
 // Equal displacement/size vectors across multiple repeated items are one
 // template-geometry hypothesis. Distinct vectors remain independent causes;
 // every raw item measurement is retained and styles never enter this group.
 const buckets=new Map<string,typeof templates>();
 for(const item of templates) {const key=item.region+":"+item.signature;buckets.set(key,[...(buckets.get(key)??[]),item]);}
 for(const [key,items] of buckets) if(items.length>=2) {
  const findings=items.flatMap(i=>i.findings),set=new Set(findings);
  for(let i=defects.length-1;i>=0;i--) if(defects[i]!.cause==='layout:geometry' && defects[i]!.findings.every(f=>set.has(f))) defects.splice(i,1);
  defects.push({id:'def-'+hash({template:key,layer:items[0]!.root}).slice(0,20),kind:'layout',cause:'layout:repeated-template',classification:'product',layer:items[0]!.root,findings,summary:`Repeated template geometry differs in ${items[0]!.region}`});
 }
 return {drifts,defects,matches,coverage,reason:null};
}
