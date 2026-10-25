/** H3 transport drill ONLY. Repo permissions are STUBBED; never production auth.
 * Client direct GitHub identity/membership checks and actual SSH key signatures remain real.
 * Usage: tsx scripts/share-deploy/h3-labelled-stub.ts PRIVATE_ROOT COMB_BINARY
 */
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile, access } from 'node:fs/promises'
import { resolve, join, isAbsolute } from 'node:path'
import { startShareService } from '../../packages/cli/src/share/service.js'
const root = process.argv[2], binary = process.argv[3]
if (!root || !binary || !isAbsolute(root) || !isAbsolute(binary)) throw new Error('absolute private root and Comb binary required')
const repo = 'honeybeehq/foundation-share-test'
for (const part of ['', 'metadata', 'objects', 'comb']) await mkdir(join(root, part), { recursive: true, mode: 0o700 })
const config = join(root, 'comb/config.toml')
try { await access(config) } catch {
  await writeFile(config, `tenant = "h3-labelled-stub"\ndigest_key = "${randomBytes(32).toString('hex')}"\n[backend]\nkind = "local"\nroot = ${JSON.stringify(resolve(root, 'objects'))}\n`, { mode: 0o600, flag: 'wx' })
}
const identityResponse = await fetch('https://api.github.com/users/trmdy', { headers: { 'User-Agent': 'foundation-h3-labelled-stub' }, redirect: 'error' })
if (!identityResponse.ok) throw new Error('real GitHub identity preflight unavailable')
const identity = await identityResponse.json() as { login: string; id: number }
if (identity.login !== 'trmdy' || identity.id !== 3416694) throw new Error('unexpected real GitHub identity')
const stub = createServer(async (req, res) => {
  try {
    const path = new URL(req.url!, 'http://stub').pathname
    if (path === '/trmdy.keys') {
      const keys = await fetch('https://github.com/trmdy.keys', { redirect: 'error' })
      res.writeHead(keys.status, { 'Content-Type': 'text/plain' }).end(await keys.text())
      return
    }
    res.setHeader('Content-Type', 'application/json')
    if (path === '/users/trmdy') { res.end(JSON.stringify(identity)); return }
    if (path === `/repos/${repo}`) { res.end(JSON.stringify({ private: true })); return }
    if (path === `/repos/${repo}/collaborators`) { res.end(JSON.stringify([{ login: 'trmdy', permissions: { push: true } }])); return }
    const match = path.match(new RegExp(`^/repos/${repo}/collaborators/([^/]+)/permission$`))
    if (match) { res.end(JSON.stringify({ permission: match[1] === 'trmdy' ? 'write' : 'none' })); return }
    res.writeHead(404).end('{}')
  } catch { res.writeHead(502).end('{}') }
})
await new Promise<void>(r => stub.listen(0, '127.0.0.1', r))
const port = (stub.address() as { port: number }).port
const service = await startShareService({ host: '127.0.0.1', port: 19488, stateDir: join(root, 'metadata'), comb: { binary, args: ['--dir', join(root, 'comb'), '--lease', '3'] }, backupLocalStore: join(root, 'objects'), githubApiUrl: `http://127.0.0.1:${port}`, githubPermissionToken: 'H3_LABELLED_STUB_NOT_A_GITHUB_TOKEN' })
console.log('LABELLED H3 PERMISSION STUB: only trmdy granted; NOT live GitHub App authorization. Real GitHub identity and SSH keys; service', service.url)
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void service.close().then(() => stub.close()) })
