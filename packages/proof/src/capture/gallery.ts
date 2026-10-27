import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PNG } from 'pngjs'

export async function writePair(folder: string) {
  const design = PNG.sync.read(await readFile(join(folder, 'design/screenshot.png')))
  const code = PNG.sync.read(await readFile(join(folder, 'code/screenshot.png')))
  const pair = new PNG({ width: design.width + code.width, height: Math.max(design.height, code.height), fill: true })
  PNG.bitblt(design, pair, 0, 0, design.width, design.height, 0, 0)
  PNG.bitblt(code, pair, 0, 0, code.width, code.height, design.width, 0)
  await writeFile(join(folder, 'side-by-side.png'), PNG.sync.write(pair))
}

export async function writeGallery(out: string, pairs: { path: string; state: string }[]) {
  await writeFile(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Tracks pane: design and code</title><style>body{margin:24px;background:#f5f4f1;color:#2e2b27;font:14px system-ui}section{margin-bottom:32px}header{display:flex;justify-content:space-between}img{width:100%;border:1px solid #e7e5e0;background:white}a{color:inherit}</style><h1>Tracks pane: design and real code</h1><p>Design is on the left. Classic Apiary is on the right. Each pair uses the same viewport, browser and fixture state. These captures show drift.</p>${pairs.map(pair => `<section><h2>${pair.state}</h2><header><p>Foundation design</p><p>Real Classic TracksPane</p></header><a href="${pair.path}/side-by-side.png"><img src="${pair.path}/side-by-side.png" alt="${pair.state}: design left, code right"></a></section>`).join('')}`)
}
