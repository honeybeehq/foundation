import {readFile,writeFile} from 'node:fs/promises'
const root='packages/proof/fixtures/components'
const cases=[['keycap','default','keycap/reports'],['inbox-row','selected','inbox-row/reports/selected'],['inbox-row','failed','inbox-row/reports/failed'],['help-center','agent-run','help-center/reports']]
const rows=[]
for(const [component,state,folder] of cases){
 let metrics:any
 try{metrics=JSON.parse(await readFile(`${root}/${folder}/ids-accuracy.json`,'utf8'))}catch{}
 const counts=JSON.parse(await readFile(`${root}/${folder}/counts.json`,'utf8'))
 const format=(a:any)=>`<tr><td>${a.mode}</td><td>${a.defects.predicted}</td><td>${a.defects.labelled}</td><td>${a.defects.tp}</td><td>${(a.strictDefects.precision*100).toFixed(1)}% / ${(a.strictDefects.recall*100).toFixed(1)}%</td><td>${(a.defects.precision*100).toFixed(1)}% / ${(a.defects.recall*100).toFixed(1)}%</td></tr>`
 let accuracy='Independent labels pending.'
 if(metrics) {
  const noIds=JSON.parse(await readFile(`${root}/${folder}/no-ids-accuracy.json`,'utf8'))
  accuracy=`<table><tr><th>Mode</th><th>Candidates</th><th>Labels</th><th>Supported</th><th>Strict precision / recall</th><th>Corrected precision / recall</th></tr>${format(metrics)}${format(noIds)}</table>`
 }
 const m=metrics?.defects
 rows.push(`<section><h2>${component} · ${state}</h2>${accuracy}<p>Counts are candidate defects, not confirmed bugs.</p><p>Design | real code | pixel difference</p><a href="${folder}/design-code-diff.png"><img src="${folder}/design-code-diff.png" alt="${component} ${state}: design, code and pixel difference"></a><p><a href="${folder}/ids.json">Report with ids</a> · <a href="${folder}/no-ids.json">Report without ids</a> · <a href="${folder}/counts.json">Counts</a>${metrics?` · <a href="${folder}/ids-accuracy.json">Accuracy and misses with ids</a> · <a href="${folder}/no-ids-accuracy.json">Accuracy without ids</a>`:''}</p></section>`)
}
await writeFile(`${root}/index.html`,`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Three components, four cases: design-to-code count accuracy</title><style>body{max-width:1500px;margin:32px auto;padding:0 20px;background:#f5f4f1;color:#2e2b27;font:16px/1.5 system-ui}h1{font-size:28px}section{border-top:1px solid #d6d3cb;margin-top:32px}img{display:block;width:100%;background:white;border:1px solid #dedbd3}a{color:#68501e}table{border-collapse:collapse}td,th{text-align:left;padding:6px 12px;border-bottom:1px solid #d6d3cb}p{max-width:90ch}</style><h1>How accurate was the count on each component?</h1><p>Three components and four captured cases. Frozen matching and grouping, pinned Chromium and fonts, real production exports. Each completed score uses an independent hand-labelled baseline. The scorer credits compatible layer/property evidence once per labelled difference; support is optimistic and does not prove equal rendering.</p>${rows.join('')}<p><a href="round3-components.md">Full report and reproduction</a></p>`)
