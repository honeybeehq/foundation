import { createRequire } from 'node:module'
import { resolve,join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { realpath,mkdtemp,rm } from 'node:fs/promises'
import {tmpdir} from 'node:os'
import type { Links } from './types.js'

export function moduleRef(repo: string, ref: string) {
  const [file, name] = ref.split('#')
  if (!file || !name) throw new Error(`Expected path#Export: ${ref}`)
  return { file: `/@fs/${resolve(repo, file)}`, name }
}

export async function startCodeServer(repo: string, links: Links) {
  const require = createRequire(resolve(repo, links.viteConfig))
  const vite = await import(pathToFileURL(require.resolve('vite')).href)
  const loaded = await vite.loadConfigFromFile({ command: 'serve', mode: 'foundation' }, resolve(repo, links.viteConfig))
  if (!loaded) throw new Error('Could not load target Vite config')
  const cacheRoot = await mkdtemp(join(tmpdir(),'foundation-proof-vite-'))
  const cacheDir = join(cacheRoot,'node_modules/.vite')
  const harness = `/@fs/${resolve(repo, links.harness)}`
  const entries = links.artboards.flatMap(board => board.states.map(state => ({ board, state })))
  const plugin = {
    name: 'foundation-proof-entry',
    configureServer(server: any) {
      server.middlewares.use('/__foundation', async (req: any, res: any, next: () => void) => {
        const index = Number(new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean)[0] ?? 0)
        const entry = entries[index]
        if (!entry) { res.statusCode = 404; res.end('Unknown capture case'); return }
        const component = moduleRef(repo, entry.board.component)
        const fixture = moduleRef(repo, entry.state.fixture)
        const source = `<html><body style="margin:0"><div id="foundation-root"></div><script type="module">
          try {
            const harness = await import(${JSON.stringify(harness)});
            await harness.prepare?.({state:${JSON.stringify(entry.state.name)}});
            const fixture = (await import(${JSON.stringify(fixture.file)}))[${JSON.stringify(fixture.name)}];
            const Component = (await import(${JSON.stringify(component.file)}))[${JSON.stringify(component.name)}];
            if (!Component) throw new Error('Linked export missing');
            window.__foundationCleanup = await harness.mount({Component,fixture,root:document.getElementById('foundation-root'),state:${JSON.stringify(entry.state.name)}});
            await document.fonts.ready;
            await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
            window.__foundationReady = true;
          } catch (error) { window.__foundationError = String(error); console.error(error); }
        </script></body></html>`
        res.setHeader('Content-Type', 'text/html')
        res.end(await server.transformIndexHtml(`/__foundation/${index}`, source))
      })
    },
  }
  const entryFiles = [...new Set([links.harness, ...entries.flatMap(({board,state}) => [board.component.split('#')[0]!, state.fixture.split('#')[0]!])])].map(file => resolve(repo,file))
  const config = { ...loaded.config, cacheDir, configFile: false, plugins: [...(loaded.config.plugins ?? []), plugin], server: { ...loaded.config.server, fs: { allow: [...(loaded.config.server?.fs?.allow ?? []), repo, await realpath(resolve(repo, 'node_modules'))] }, host: '127.0.0.1', port: 0, strictPort: false, hmr: false }, optimizeDeps: { ...loaded.config.optimizeDeps, entries:entryFiles, include: [...(loaded.config.optimizeDeps?.include ?? []), 'react', 'react-dom/client', 'react/jsx-runtime'] } }
  const server = await vite.createServer(config)
  await server.listen()
  await server.environments.client.depsOptimizer?.scanProcessing
  return { server, url: server.resolvedUrls.local[0] as string, entries, close:async () => {await server.close();await rm(cacheRoot,{recursive:true,force:true})} }
}
