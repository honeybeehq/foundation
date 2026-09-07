import { build } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = path.join(root, 'dist')
await mkdir(path.join(dist, 'assets'), { recursive: true })
let html = await readFile(path.join(root, '../../spikes/desktop-prototype/index.html'), 'utf8')
const modelCode = html.match(/<script id="document-model">([\s\S]*?)<\/script>/)?.[1]
if (!modelCode) throw new Error('Prototype model script missing')
const initial = vm.runInNewContext(`${modelCode};initialDocument`, { structuredClone })
const assetWrites = []
const assets = []
html = html.replace(/data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)/g, (_all, format, base64) => {
  const bytes = Buffer.from(base64, 'base64')
  const ref = `assets/${createHash('sha256').update(bytes).digest('hex').slice(0, 20)}.${format}`
  assets.push(ref)
  assetWrites.push(writeFile(path.join(dist, ref), bytes))
  return ref
})
await Promise.all(assetWrites)
const modelBundle = await build({ entryPoints: [path.join(root, 'src/model.ts')], bundle: true, write: false, format: 'esm', platform: 'node' })
const { seedDocument } = await import(`data:text/javascript;base64,${Buffer.from(modelBundle.outputFiles[0].text).toString('base64')}`)
const seed = seedDocument(initial, assets[0])
await writeFile(path.join(dist, 'seed.json'), JSON.stringify(seed, null, 2))
let scriptIndex = 0
const scriptWrites = []
html = html.replace(/<script([^>]*)>([\s\S]*?)<\/script>/g, (_all, attrs, source) => {
  const filename = `study-${scriptIndex++}.js`
  scriptWrites.push(writeFile(path.join(dist, filename), source))
  return `<script${attrs} src="${filename}"></script>`
})
html = html.replace('<head>', '<head>\n<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; font-src \'self\'; connect-src \'none\'; base-uri \'none\'; form-action \'none\'">')
html = html.replace('</head>', '<link rel="stylesheet" href="desktop.css"></head>')
html = html.replace('<body>', '<body class="host-loading">')
html = html.replace('</body>', '<script src="renderer.js"></script></body>')
await Promise.all(scriptWrites)
await writeFile(path.join(dist, 'index.html'), html)
await writeFile(path.join(dist, 'desktop.css'), await readFile(path.join(root, 'src/desktop.css')))
await Promise.all([
  build({ entryPoints: [path.join(root, 'src/main.ts')], outfile: path.join(dist, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ entryPoints: [path.join(root, 'src/preload.ts')], outfile: path.join(dist, 'preload.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ entryPoints: [path.join(root, 'src/renderer.ts')], outfile: path.join(dist, 'renderer.js'), bundle: true, platform: 'browser', format: 'iife' }),
])
console.log(`Desktop built. Seed ${Buffer.byteLength(JSON.stringify(seed))} bytes; ${new Set(assets).size} bundled image assets.`)
