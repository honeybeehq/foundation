import { spawn, type ChildProcess } from 'node:child_process'
import { readFile, access, mkdir, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { record } from './contract.js'
import { loopbackURL } from './host-client.js'

export interface RunningHost { url: string; tokenFile: string; process: ChildProcess }

export async function localCombConfiguration(directory: string, objectDirectory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await mkdir(objectDirectory, { recursive: true, mode: 0o700 })
  const config = `tenant = "foundation_desktop"\ndigest_key = "${randomBytes(32).toString('hex')}"\n[backend]\nkind = "local"\nroot = ${JSON.stringify(path.resolve(objectDirectory))}\n`
  try { await writeFile(path.join(directory, 'config.toml'), config, { flag: 'wx', mode: 0o600 }) }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error }
}

/** Packaged resources contain Node 24, the host bundle and Comb. No repo paths. */
export async function startBundledHost(runtimeDirectory: string, stateDirectory: string, combDirectory?: string): Promise<RunningHost> {
  const manifest: unknown = JSON.parse(await readFile(path.join(runtimeDirectory, 'runtime.json'), 'utf8'))
  if (!record(manifest) || typeof manifest.entry !== 'string' || typeof manifest.node !== 'string' || typeof manifest.comb !== 'string' || typeof manifest.remote !== 'string') throw new Error('Invalid bundled host runtime manifest')
  const resource = (relative: string) => {
    const resolved = path.resolve(runtimeDirectory, relative)
    if (!resolved.startsWith(path.resolve(runtimeDirectory) + path.sep)) throw new Error('Runtime resource must be inside the bundle')
    return resolved
  }
  const node = resource(manifest.node), entry = resource(manifest.entry), comb = resource(manifest.comb)
  await Promise.all([access(node), access(entry), access(comb)])
  const config = combDirectory ?? path.join(stateDirectory, 'comb')
  if (!combDirectory) await localCombConfiguration(config, path.join(stateDirectory, 'object-store'))
  const child = spawn(node, [entry, '--state-dir', stateDirectory, '--comb-bin', comb, '--comb-dir', config, '--remote', manifest.remote, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  // Do not mirror service output: it may contain user content or credentials.
  child.stderr?.on('data', () => undefined)
  return new Promise((resolve, reject) => {
    const lines = createInterface({ input: child.stdout! })
    const timer = setTimeout(() => fail(new Error('Bundled host did not become ready within 30 seconds')), 30_000)
    const fail = (error: Error) => { clearTimeout(timer); lines.close(); child.kill(); reject(error) }
    child.once('error', fail)
    child.once('exit', code => fail(new Error(`Bundled host exited (${code})`)))
    lines.once('line', line => {
      try {
        const info: unknown = JSON.parse(line)
        if (!record(info) || typeof info.url !== 'string' || typeof info.tokenFile !== 'string') throw new Error('Bundled host returned invalid startup information')
        const url = loopbackURL(info.url)
        clearTimeout(timer); lines.close(); child.removeListener('error', fail)
        resolve({ url, tokenFile: info.tokenFile, process: child })
      } catch (error) { fail(error instanceof Error ? error : new Error('Invalid host startup response')) }
    })
  })
}

export function options(argv: string[]): Map<string, string> {
  const out = new Map<string, string>()
  const allowed = new Set(['host-url', 'host-token-file', 'replica-dir', 'doc-id', 'author', 'runtime-dir', 'comb-dir', 'recover'])
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!
    if (!argument.startsWith('--')) continue
    const [key, inline] = argument.slice(2).split('=', 2)
    if (!key || !allowed.has(key)) continue
    if (key === 'recover') { out.set(key, 'true'); continue }
    const value = inline ?? argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`)
    out.set(key, value)
  }
  return out
}
