import type {CaptureNode, Match} from './types.ts';
const clear = (v = '') => !v || v === 'none' || v === 'transparent' || /^rgba\([^)]*,\s*0\)$/.test(v);
export function visual(n: CaptureNode) {
  const s=n.style;
  return n.box[2]>0 && n.box[3]>0 && s.display!=='none' && s.visibility!=='hidden' && s.opacity!=='0' &&
    (!!n.text?.trim() || !!n.role || ['img','svg','input','button','canvas','video'].includes(n.tag) ||
    !clear(s['background-color']) || !clear(s['background-image']) || !clear(s['box-shadow']) ||
    ['top','right','bottom','left'].some(k=>parseFloat(s[`border-${k}-width`]||'0')>0) ||
    ['flex','grid','inline-flex','inline-grid'].includes(s.display||''));
}
function iou(a:CaptureNode,b:CaptureNode) { const [x,y,w,h]=a.box,[u,v,p,q]=b.box; const n=Math.max(0,Math.min(x+w,u+p)-Math.max(x,u))*Math.max(0,Math.min(y+h,v+q)-Math.max(y,v)); return n/(w*h+p*q-n||1); }
function cost(a:CaptureNode,b:CaptureNode) {
 const text=(a.text||'').trim(), other=(b.text||'').trim();
 return .4*(text===other?0:text&&other?1:.7)+.15*(a.tag===b.tag?0:1)+.15*((a.role||'')===(b.role||'')&&(a.name||'')===(b.name||'')?0:1)+.25*(1-iou(a,b))+.05*(a.path===b.path?0:1);
}
// Minimum-cost rectangular assignment, with dummy columns for unmatched nodes.
function assign(a:number[][]): number[] {
 const n=a.length,m=a[0]?.length||0,u=Array(n+1).fill(0),v=Array(m+1).fill(0),p=Array(m+1).fill(0),way=Array(m+1).fill(0);
 for(let i=1;i<=n;i++){p[0]=i;let j0=0;const min=Array(m+1).fill(Infinity),used=Array(m+1).fill(false);
 do {used[j0]=true;const i0=p[j0];let delta=Infinity,j1=0;for(let j=1;j<=m;j++)if(!used[j]){const cur=a[i0-1]![j-1]!-u[i0]-v[j];if(cur<min[j]){min[j]=cur;way[j]=j0;}if(min[j]<delta){delta=min[j];j1=j;}}for(let j=0;j<=m;j++)if(used[j]){u[p[j]]+=delta;v[j]-=delta;}else min[j]-=delta;j0=j1;}while(p[j0]!==0);
 do {const j1=way[j0];p[j0]=p[j1];j0=j1;}while(j0);
 } const out=Array(n).fill(-1);for(let j=1;j<=m;j++)if(p[j])out[p[j]-1]=j-1;return out;
}
export function matchNodes(design:CaptureNode[],code:CaptureNode[]) {
 const d=design.filter(visual),c=code.filter(visual),matches:Match[]=[],usedD=new Set<CaptureNode>(),usedC=new Set<CaptureNode>();
 for(const a of d)if(a.fdnId){const ds=d.filter(n=>n.fdnId===a.fdnId),cs=c.filter(n=>n.fdnId===a.fdnId);if(ds.length===1&&cs.length===1){const b=cs[0]!;matches.push({design:a,code:b,kind:'id',confidence:1});usedD.add(a);usedC.add(b);}}
 const left=d.filter(n=>!usedD.has(n)),right=c.filter(n=>!usedC.has(n));
 if(left.length){const matrix=left.map(a=>[...right.map(b=>cost(a,b)),...left.map(()=>.48)]);const assignment=assign(matrix);left.forEach((a,i)=>{const j=assignment[i]!;if(j>=0&&j<right.length&&matrix[i]![j]!<.48){const b=right[j]!;matches.push({design:a,code:b,kind:'heuristic',confidence:Math.round((1-matrix[i]![j]!)*1000)/1000});usedD.add(a);usedC.add(b);}});}
 return {matches,missing:d.filter(n=>!usedD.has(n)),extra:c.filter(n=>!usedC.has(n))};
}
