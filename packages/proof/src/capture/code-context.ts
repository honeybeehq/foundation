import type {Page} from 'playwright';
import {preserveDesignContext} from './design-context.ts';

/** Select a code component in place, preserving its ambient host dimensions. */
export async function preserveCodeContext(page:Page,selector:string,properties:readonly string[]) {
 const host=await page.evaluate(({selector,properties})=>{
  const root=document.querySelector<HTMLElement>('#foundation-root');
  const selected=document.querySelector<HTMLElement>(selector);
  if(!root || !selected || root===selected || !root.contains(selected)) throw Error('Code context boundary must select one descendant of the fixture host');
  if(document.querySelectorAll(selector).length!==1) throw Error('Code context boundary is ambiguous');
  if(document.getElementById('foundation-code-host')) throw Error('Code context host marker already exists');
  const nodes=[selected,...selected.querySelectorAll('*')],origin=selected.getBoundingClientRect();
  const before=nodes.map(el=>{const box=el.getBoundingClientRect();return {box:[box.x-origin.x,box.y-origin.y,box.width,box.height],style:properties.map(p=>getComputedStyle(el).getPropertyValue(p))};});
  const rect=root.getBoundingClientRect(),css=getComputedStyle(root);
  const extra=(axis:'x'|'y')=>css.boxSizing==='border-box'?0:(axis==='x'?['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth']:['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth']).reduce((n,k)=>n+parseFloat(css[k as keyof CSSStyleDeclaration] as string||'0'),0);
  root.style.width=`${rect.width-extra('x')}px`;root.style.height=`${rect.height-extra('y')}px`;root.id='foundation-code-host';
  const afterOrigin=selected.getBoundingClientRect();
  const changed=nodes.some((el,i)=>{const r=el.getBoundingClientRect(),b=before[i]!;return [r.x-afterOrigin.x,r.y-afterOrigin.y,r.width,r.height].some((v,j)=>Math.abs(v-b.box[j]!)>.05)||properties.some((p,j)=>getComputedStyle(el).getPropertyValue(p)!==b.style[j]);});
  if(changed) throw Error('Code context changed while preserving the fixture host');
  return {frame:[rect.x,rect.y,rect.width,rect.height],nodes:nodes.length};
 },{selector,properties:[...properties]});
 const isolation=await preserveDesignContext(page,selector,properties);
 return {...isolation,fixtureHost:host};
}
