import {expect,it} from 'vitest';
import {compare} from './index.ts';
import {properties} from './style.ts';
import {PNG} from 'pngjs';
import type {Capture,CaptureNode} from './types.ts';
const image=PNG.sync.write(new PNG({width:200,height:200}));
const node=(path:string,over:Partial<CaptureNode>={}):CaptureNode=>({path,tag:'div',box:[0,0,100,20],style:Object.fromEntries(properties.map(p=>[p,'0px'])),...over});
const cap=(nodes:CaptureNode[]):Capture=>({nodes,meta:{},screenshot:image});
it('does not call an unused fallback-stack spelling a rendered font defect',()=>{
 const a=node('0',{text:'Label',authoredFontFamily:'"Pinned Mono", monospace'}),b=structuredClone(a);
 a.style['font-family']=b.style['font-family']='"Pinned Mono", monospace';
 b.authoredFontFamily='"Pinned Mono", ui-monospace, monospace';
 const r=compare(cap([a]),cap([b])).report;
 expect(r.defects.filter(d=>d.classification==='product')).toHaveLength(0);
 expect(r.drifts.some(d=>d.property==='font-family')).toBe(true);
});
it('does not count a box-sizing spelling with identical borderless geometry',()=>{
 const a=node('0',{text:'Label'}),b=structuredClone(a);
 a.style['box-sizing']='content-box';b.style['box-sizing']='border-box';
 expect(compare(cap([a]),cap([b])).report.defects.filter(d=>d.classification==='product')).toHaveLength(0);
});
it('pairs changed direct copy without counting its accessible name twice',()=>{
 const a=node('0/0',{text:'Old note',name:'Old note'}),b=node('0/0',{text:'New note',name:'New note'});
 const r=compare(cap([a]),cap([b])).report;
 expect(r.drifts.filter(d=>d.property==='text')).toHaveLength(1);
 expect(r.drifts.filter(d=>d.kind==='missing'||d.kind==='extra')).toHaveLength(0);
});
it('recovers the sole changed text slot under an anchored row despite changed width',()=>{
 const p=node('0',{fdnId:'row'}),a=node('0/0',{text:'Old long note',name:'Old long note',box:[0,0,40,20]}),b=node('0/1',{text:'New long note',name:'New long note',box:[100,0,80,20]});
 expect(compare(cap([p,a]),cap([p,b])).report.drifts.filter(d=>d.property==='text')).toHaveLength(1);
});
it('ignores font inheritance on a textless button with text children',()=>{
 const a=node('0',{fdnId:'row',tag:'div'}),b=structuredClone(a);b.tag='button';
 b.style['font-size']='13px';a.style['font-size']='16px';
 const child=node('0/0',{fdnId:'label',text:'Same'});
 expect(compare(cap([a,child]),cap([b,child])).report.drifts.some(d=>d.property==='font-size')).toBe(false);
});
it('keeps transform evidence local to the nearest matched boundary',()=>{
 const a=node('0',{fdnId:'row'}),b=structuredClone(a);
 a.paint={transform:'none'};b.paint={transform:'matrix(1, 0, 0, 1, 200, 0)'};
 const child=node('0/0',{fdnId:'label',text:'Same',paint:{transform:'none'}});
 expect(compare(cap([a,child]),cap([b,child])).report.drifts.some(d=>d.property==='transform')).toBe(false);
});
it('does not report an inert SVG group as an icon replacement',()=>{
 const a=node('0',{fdnId:'icon',tag:'svg',paint:{attributes:{viewBox:'0 0 16 16'}}}),b=structuredClone(a);
 const circle=node('0/0',{tag:'circle',paint:{attributes:{cx:'8',cy:'8',r:'2'}}});
 const group=node('0/0',{tag:'g',paint:{transform:'none',attributes:{'data-fdn-id':'authoring-wrapper'}}});
 expect(compare(cap([a,group,{...circle,path:'0/0/0'}]),cap([b,circle])).report.drifts.some(d=>d.property==='icon')).toBe(false);
});
it('keeps inactive flex configuration as uncertainty',()=>{
 const a=node('0',{fdnId:'item',text:'Same'}),b=structuredClone(a);
 a.style['flex-shrink']='1';b.style['flex-shrink']='0';
 const r=compare(cap([a]),cap([b])).report;
 expect(r.defects.filter(d=>d.classification==='product')).toHaveLength(0);
 expect(r.drifts.some(d=>d.property==='flex-shrink')).toBe(true);
});
it('measures uniquely identified clipped cards below the fold',()=>{
 const visibility={eligible:true,clips:[]};
 const root=node('0',{fdnId:'pane',box:[0,0,200,200]});
 const a=node('0/0',{box:[0,250,100,40],visibility}),b=node('0/1',{box:[0,292,120,40],visibility});
 const title=node('0/0/0',{text:'Unique title',box:[0,250,40,20],visibility}),note=node('0/0/1',{text:'Unique note',box:[0,270,40,20],visibility});
 const r=compare(cap([root,a,title,note]),cap([root,b,{...title,path:'0/1/0',box:[0,292,40,20]},{...note,path:'0/1/1',box:[0,312,40,20]}])).report;
 expect(r.drifts.some(d=>d.property==='width' && d.design===100 && d.code===120)).toBe(true);
 expect(r.drifts.some(d=>d.property==='y' && Number(d.code)-Number(d.design)===42)).toBe(true);
});
