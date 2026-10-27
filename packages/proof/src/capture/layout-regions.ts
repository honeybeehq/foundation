import type {Page} from 'playwright';
export interface LayoutRegionLink {
  id: string;
  designNode: string;
  codeSelector: string;
  repeat?: {designSelector: string; codeSelector: string};
}
export interface CapturedLayoutRegion {
  id: string;
  root: string | null;
  items?: string[];
}
export async function captureLayoutRegions(page:Page,side:'design'|'code',regions:LayoutRegionLink[]):Promise<CapturedLayoutRegion[]> {
  if(new Set(regions.map(r=>r.id)).size!==regions.length || regions.some(r=>!r.id || !r.designNode || !r.codeSelector)) throw Error('Layout-only regions need unique ids and paired selectors');
  return page.evaluate(({side,regions})=>{
    const boundary=document.querySelector('#foundation-root')!;
    const paths=new Map<Element,string>();
    const visit=(el:Element,path:string)=>{paths.set(el,path);Array.from(el.children).forEach((child,i)=>visit(child,`${path}/${i}`));};
    visit(boundary,'0');
    return regions.map(region=>{
      const selector=side==='design' ? `[data-fdn-id="${CSS.escape(region.designNode)}"]` : region.codeSelector;
      const roots=Array.from(boundary.querySelectorAll(selector));
      if(roots.length>1) throw Error(`Layout-only region ${region.id} has ambiguous ${side} marker`);
      const root=roots[0];
      if(!root) return {id:region.id,root:null,...(region.repeat?{items:[]}: {})};
      const items=region.repeat ? Array.from(root.querySelectorAll(side==='design'?region.repeat.designSelector:region.repeat.codeSelector)).map(el=>paths.get(el)!) : undefined;
      if(items && items.some((path,i)=>items.some((other,j)=>i!==j && path.startsWith(other+'/')))) throw Error(`Layout-only region ${region.id} has nested repeated items`);
      return {id:region.id,root:paths.get(root)!,...(items?{items}: {})};
    });
  },{side,regions});
}
