import {it,expect} from 'vitest';
import {PNG} from 'pngjs';
import {compare} from './index.ts';
import {properties} from './style.ts';
import type {Capture,CaptureNode} from './types.ts';
const image=PNG.sync.write(new PNG({width:200,height:200}));
const n=(path:string,text='',box:CaptureNode['box']=[0,0,100,20]):CaptureNode=>({path,text,tag:'div',box,style:Object.fromEntries(properties.map(p=>[p,'0px']))});
const cap=(nodes:CaptureNode[],items?:string[]):Capture=>({nodes,screenshot:image,meta:{layoutOnlyRegions:[{id:'region',root:'0',...(items?{items}:{})}]}});
const run=(a:Capture,b:Capture)=>compare(a,b,{}, {mode:'layout-only'}).report;
it('ignores text and style but reports declared box differences',()=>{
 const a=cap([n('0','Original')]),b=cap([n('0','Different')]);
 b.nodes[0]!.style.color='red';
 expect(run(a,b).verdict).toBe('match');
 b.nodes[0]!.box[2]+=10;
 expect(run(a,b).drifts.map(d=>d.property)).toEqual(['width']);
});
it('does not let pixel-only changes set a layout verdict',()=>{
 const a=cap([n('0')]),b=cap([n('0')]);const p=new PNG({width:200,height:200});p.data.fill(255);b.screenshot=PNG.sync.write(p);
 expect(run(a,b).pixels.diffRatio).toBeGreaterThan(0);
 expect(run(a,b).verdict).toBe('match');
});
it('fails visibly for absent declarations or missing markers',()=>{
 const a=cap([n('0')]),b=cap([n('0')]);delete b.meta.layoutOnlyRegions;
 expect(run(a,b)).toMatchObject({provable:false,verdict:'not-provable'});
 b.meta.layoutOnlyRegions=[{id:'region',root:null}];
 expect(run(a,b).reason).toContain('missing marker');
});
it('ignores excess repeated data while comparing the common template',()=>{
 const root=n('0'),one=n('0/0','A',[0,0,100,20]),two=n('0/1','B',[0,30,100,20]);
 const a=cap([root,one],['0/0']),b=cap([root,one,two],['0/0','0/1']);
 expect(run(a,b).verdict).toBe('match');
 expect(run(a,b).comparison?.coverage[0]?.ignoredCodeItems).toBe(1);
});
it('detects loss of every item and spacing/alignment changes',()=>{
 const root=n('0'),one=n('0/0','A',[0,0,100,20]),two=n('0/1','B',[0,30,100,20]);
 const a=cap([root,one,two],['0/0','0/1']),b=cap([root],[]);
 expect(run(a,b).drifts.some(d=>d.property==='presence')).toBe(true);
 const c=cap([root,one,{...two,box:[10,40,100,20]}],['0/0','0/1']);
 expect(run(a,c).drifts.map(d=>d.property)).toEqual(['x','y']);
});
it('retains semantic order with shared stable item ids',()=>{
 const root=n('0'),a={...n('0/0','First'),fdnId:'first'},b={...n('0/1','Second'),fdnId:'second'};
 const left=cap([root,a,b],['0/0','0/1']),right=cap([root,{...b,path:'0/0'},{...a,path:'0/1'}],['0/0','0/1']);
 expect(run(left,right).drifts.some(d=>d.property==='order')).toBe(true);
});
it('does not change the default full check',()=>{
 const a=cap([n('0','A')]),b=cap([n('0','B')]);
 expect(compare(a,b).report.drifts.some(d=>d.property==='text')).toBe(true);
 expect(compare(a,b).report).not.toHaveProperty('comparison');
});
it('does not duplicate a parent displacement in a declared child',()=>{
 const a=cap([n('0'),n('0/0','child',[10,5,20,10])]),b=cap([n('0','',[20,0,100,20]),n('0/0','new',[30,5,20,10])]);
 a.meta.layoutOnlyRegions.push({id:'child',root:'0/0'});b.meta.layoutOnlyRegions.push({id:'child',root:'0/0'});
 const r=run(a,b);
 expect(r.drifts).toHaveLength(1);expect(r.drifts[0]?.designNode).toBe('0');
});
it('compares all common template items when stable ids overlap only partially',()=>{
 const root=n('0'),one={...n('0/0','A'),fdnId:'shared'},two=n('0/1','B');
 const a=cap([root,one,two],['0/0','0/1']),b=cap([root,one,{...two,box:[0,0,130,20]}],['0/0','0/1']);
 expect(run(a,b).drifts.map(d=>d.property)).toEqual(['width']);
});
it('groups equal repeated-item geometry vectors without swallowing independent item changes',()=>{
 const root=n('0','',[0,0,100,100]);
 const a=cap([root,n('0/0','A',[0,0,100,20]),n('0/1','B',[0,30,100,20]),n('0/2','C',[0,60,100,20])],['0/0','0/1','0/2']);
 const b=cap([root,n('0/0','Other',[5,0,100,20]),n('0/1','Data',[5,30,100,20]),n('0/2','Values',[0,60,130,20])],['0/0','0/1','0/2']);
 const r=run(a,b);
 expect(r.defects.filter(d=>d.cause==='layout:repeated-template')).toHaveLength(1);
 expect(r.defects.filter(d=>d.cause==='layout:geometry')).toHaveLength(1);
 expect(r.drifts).toHaveLength(3);
 expect(r.defects.flatMap(d=>d.findings).sort()).toEqual(r.drifts.map(d=>d.id).sort());
});
