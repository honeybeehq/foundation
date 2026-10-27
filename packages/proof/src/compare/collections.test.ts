import {it,expect} from 'vitest';
import {changedCollections} from './collections.ts';
import {groupDefects} from './defects.ts';
import type {CaptureNode,Capture,Drift} from './types.ts';
const n=(path:string,text=''):CaptureNode=>({path,tag:'div',text,box:[0,0,100,20],style:{display:'flex'}});
it('keeps substantial collection data changes uncertain without swallowing styles',()=>{
 const root=n('0'),a=n('0/0'),b=n('0/0');
 const left=[root,a,...['Shared alpha','Shared beta','Old gamma','Old delta','Old epsilon'].map((t,i)=>n(`0/0/${i}`,t))];
 const right=[root,b,...['Shared alpha','Shared beta','New gamma','New delta','New epsilon','New zeta'].map((t,i)=>n(`0/0/${i}`,t))];
 const matches=[{design:root,code:root,kind:'id' as const,confidence:1}];
 expect(changedCollections(left,right,matches)).toHaveLength(1);
 const capture=(nodes:CaptureNode[]):Capture=>({nodes,meta:{},screenshot:Buffer.alloc(0)});
 const raw:Drift[]=[{id:'copy',kind:'missing',property:'node',designNode:'0/0/2',confidence:0},{id:'ink',kind:'style',property:'color',designNode:'0/0',codeNode:'0/0',design:'black',code:'red',confidence:1}];
 const groups=groupDefects(raw,matches,capture(left),capture(right));
 expect(groups.find(d=>d.findings.includes('copy'))?.classification).toBe('uncertain');
 expect(groups.find(d=>d.findings.includes('ink'))?.classification).toBe('product');
});
it('does not turn a single missing row in a mostly identical list into data uncertainty',()=>{
 const root=n('0'),a=n('0/0'),b=n('0/0');
 const left=[root,a,...['One','Two','Three','Four','Five'].map((t,i)=>n(`0/0/${i}`,t))];
 const right=[root,b,...['One','Two','Three','Four'].map((t,i)=>n(`0/0/${i}`,t))];
 expect(changedCollections(left,right,[{design:root,code:root,kind:'id',confidence:1}])).toHaveLength(0);
});
