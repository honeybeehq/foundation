import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {readCapture} from '../src/compare/index.ts'
import {csv,defectMetrics} from '../src/compare/ground-truth.ts'
const rows=[]
for(const state of ['track-selected','proposal-pending','empty']) {
 const pair=join('packages/proof/fixtures/sample-captures/tracks-pane',state,'1416x720@1')
 const d=await readCapture(join(pair,'design')),c=await readCapture(join(pair,'code'))
 const labels=csv(await readFile(`packages/proof/fixtures/ground-truth/${state}.defects.csv`,'utf8'))
 for(const mode of ['ids','no-ids']) {
  const source=`packages/proof/src/compare/evidence/round2/${state}-${mode}.json`
  const report=JSON.parse(await readFile(source,'utf8'))
  const strip=(ns:typeof d.nodes)=>ns.map(n=>({...n,fdnId:null}))
  const dn=mode==='ids'?d.nodes:strip(d.nodes),cn=mode==='ids'?c.nodes:strip(c.nodes)
  const strict=defectMetrics(report.defects,report.drifts,labels,dn,cn,{expandShorthands:false})
  const expanded=defectMetrics(report.defects,report.drifts,labels,dn,cn)
  const compact=(m:typeof strict)=>({tp:m.tp,fp:m.fp,fn:m.fn,precision:m.precision,recall:m.recall,predicted:m.predicted,labelled:m.labelled})
  rows.push({state,mode,source,strict:compact(strict),expanded:compact(expanded)})
 }
}
await writeFile('packages/proof/fixtures/components/evidence/tracks-shorthand-scores.json',JSON.stringify(rows,null,2)+'\n')
console.log(rows)
