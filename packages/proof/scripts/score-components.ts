import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {readCapture} from '../src/compare/index.ts'
import {csv,correspondenceMetrics,defectMetrics} from '../src/compare/ground-truth.ts'
const [component,state,pair,reports]=process.argv.slice(2)
if(!component||!state||!pair||!reports) throw Error('Usage: score-components.ts COMPONENT STATE PAIR REPORTS')
const d=await readCapture(join(pair,'design')),c=await readCapture(join(pair,'code'))
const labels=join('packages/proof/fixtures/ground-truth',component,state)
const correspondence=csv(await readFile(labels+'.correspondence.csv','utf8'))
const defects=csv(await readFile(labels+'.defects.csv','utf8'))
for(const name of ['ids','no-ids']) {
 const report=JSON.parse(await readFile(join(reports,name+'.json'),'utf8'))
 const strip=(nodes:typeof d.nodes)=>nodes.map(n=>({...n,fdnId:null}))
 const dn=name==='ids'?d.nodes:strip(d.nodes),cn=name==='ids'?c.nodes:strip(c.nodes)
 const result={component,state,mode:name,correspondence:correspondenceMetrics(report,correspondence,dn,cn),defects:defectMetrics(report.defects,report.drifts,defects,dn,cn),compareMs:report.timingsMs.compare}
 await writeFile(join(reports,name+'-accuracy.json'),JSON.stringify(result,null,2)+'\n')
 console.log(component,state,name,JSON.stringify({correspondence:result.correspondence,defects:{...result.defects,agreement:undefined,falsePositives:undefined,falseNegatives:undefined}}))
}
