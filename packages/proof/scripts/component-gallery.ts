import {readFile,writeFile} from 'node:fs/promises'
const root='packages/proof/fixtures/components'
const cases=[['keycap','default','keycap/reports'],['inbox-row','selected','inbox-row/reports/selected'],['inbox-row','failed','inbox-row/reports/failed'],['help-center','agent-run','help-center/reports']]
const rows=[]
for(const [component,state,folder] of cases){
 let metrics:any
 try{metrics=JSON.parse(await readFile(`${root}/${folder}/ids-accuracy.json`,'utf8'))}catch{}
 const counts=JSON.parse(await readFile(`${root}/${folder}/counts.json`,'utf8'))
 const m=metrics?.defects
 rows.push(`<section><h2>${component} · ${state}</h2><p>${m?`${m.predicted} candidates; ${m.labelled} hand-checked differences; ${m.tp} supported. Precision ${(m.precision*100).toFixed(1)}%, recall ${(m.recall*100).toFixed(1)}%.`:'Independent labels pending.'} Counts are candidate defects, not confirmed bugs.</p><p>Design | real code | pixel difference</p><a href="${folder}/design-code-diff.png"><img src="${folder}/design-code-diff.png" alt="${component} ${state}: design, code and pixel difference"></a><p><a href="${folder}/ids.json">Report with ids</a> · <a href="${folder}/no-ids.json">Report without ids</a> · <a href="${folder}/counts.json">Counts</a>${metrics?` · <a href="${folder}/ids-accuracy.json">Accuracy and misses with ids</a> · <a href="${folder}/no-ids-accuracy.json">Accuracy without ids</a>`:''}</p></section>`)
}
await writeFile(`${root}/index.html`,`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Three components: design-to-code count accuracy</title><style>body{max-width:1500px;margin:32px auto;padding:0 20px;background:#f5f4f1;color:#2e2b27;font:16px/1.5 system-ui}h1{font-size:28px}section{border-top:1px solid #d6d3cb;margin-top:32px}img{display:block;width:100%;background:white;border:1px solid #dedbd3}a{color:#68501e}p{max-width:90ch}</style><h1>How accurate was the count on each component?</h1><p>Frozen matching and grouping, pinned Chromium and fonts, real production exports, independent blind hand labels. The scorer credits compatible layer/property evidence once per labelled difference; support is optimistic and does not prove equal rendering.</p>${rows.join('')}<p><a href="round3-components.md">Full report and reproduction</a></p>`)
