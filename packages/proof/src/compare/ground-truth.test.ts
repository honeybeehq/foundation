import {expect,it} from 'vitest'
import {defectMetrics} from './ground-truth.ts'
import type {Defect,Drift} from './types.ts'
it.each([
 ['border-color','border-top-color'],['border-width','border-left-width'],
 ['border-style','border-bottom-style'],['padding','padding-right'],
 ['margin','margin-top'],['inset','left'],['gap','column-gap'],
 ['border-radius','border-top-right-radius'],['font','font-family'],
])('credits %s labels for %s evidence', (label,property)=>{
 const drift={id:'d1',kind:'style',property,designNode:'0/0',codeNode:'0/0'} as Drift
 const defect:Defect={id:'candidate',kind:'style',cause:'style',classification:'product',layer:{design:'0/0',code:'0/0'},findings:['d1'],summary:'difference'}
 const labels=[{id:'truth',kind:'style',design_layer:'0/0',code_layer:'0/0',properties:label}]
 const result=defectMetrics([defect],[drift],labels,[],[])
 expect(result.tp).toBe(1)
 expect(result.fp).toBe(0)
 expect(result.fn).toBe(0)
})
it('does not credit unrelated properties on a labelled layer',()=>{
 const drift={id:'d1',kind:'style',property:'color',designNode:'0/0'} as Drift
 const defect:Defect={id:'candidate',kind:'style',cause:'style',classification:'product',layer:{design:'0/0'},findings:['d1'],summary:'difference'}
 expect(defectMetrics([defect],[drift],[{id:'truth',kind:'style',design_layer:'0/0',properties:'border-color'}],[],[]).tp).toBe(0)
})
