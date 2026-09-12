// Rebuild the desktop from this checkout, package a fresh Foundation.app and install it.
//
//   pnpm deploy:desktop                # build, package, replace ~/Applications/Foundation.app
//   pnpm deploy:desktop --open         # ...and launch it afterwards
//   pnpm deploy:desktop --no-install   # only build and package under packages/desktop/release
//
// The host bundle, Node executable and accepted Comb bridge are taken from the currently
// installed app's Contents/Resources/host by default. Override with --runtime <dir>, or
// individually with --host-bundle, --node-bin, --comb-bin. --target changes the install path.
import { access, mkdir, rename, readFile } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'

const desktop = fileURLToPath(new URL('..', import.meta.url))
const repo = path.resolve(desktop, '../..')
const { values } = parseArgs({ options: {
  open: { type: 'boolean' }, 'no-install': { type: 'boolean' }, help: { type: 'boolean' },
  target: { type: 'string' }, runtime: { type: 'string' },
  'host-bundle': { type: 'string' }, 'node-bin': { type: 'string' }, 'comb-bin': { type: 'string' },
} })
if (values['help']) {
  const source = await readFile(fileURLToPath(import.meta.url), 'utf8')
  console.log(source.split('\n').filter(line => line.startsWith('//')).map(line => line.slice(3)).join('\n'))
  process.exit(0)
}

const target = path.resolve(values['target'] ?? path.join(os.homedir(), 'Applications/Foundation.app'))
const runtime = path.resolve(values['runtime'] ?? path.join(target, 'Contents/Resources/host'))
const hostBundle = path.resolve(values['host-bundle'] ?? path.join(runtime, 'service'))
const nodeBin = path.resolve(values['node-bin'] ?? path.join(runtime, 'bin/node'))
const combBin = path.resolve(values['comb-bin'] ?? path.join(runtime, 'bin/comb'))
for (const [label, file] of [['host bundle entry', path.join(hostBundle, 'service-main.mjs')], ['Node executable', nodeBin], ['Comb bridge', combBin]]) {
  try { await access(file) } catch { throw new Error(`Missing ${label}: ${file}\nPass --runtime/--host-bundle/--node-bin/--comb-bin explicitly.`) }
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
const release = path.join(desktop, 'release', `Foundation-${stamp}.app`)
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
const dirty = execFileSync('git', ['status', '--porcelain', '--', 'packages/desktop/src', 'spikes/desktop-prototype'], { cwd: repo, encoding: 'utf8' }).trim() !== ''

function run(command, args, cwd = repo) {
  console.log(`\n$ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`)
}

console.log(`Foundation desktop deploy\n  source   ${repo} @ ${commit}${dirty ? ' (uncommitted desktop changes)' : ''}\n  runtime  ${runtime}\n  release  ${release}\n  install  ${values['no-install'] ? '(skipped)' : target}`)
run('pnpm', ['--filter', 'foundation-desktop', 'build'])
await mkdir(path.dirname(release), { recursive: true })
run('node', [path.join(desktop, 'scripts/package.mjs'), '--host-bundle', hostBundle, '--node-bin', nodeBin, '--comb-bin', combBin, '--output', release])
if (values['no-install']) { console.log(`\nPackaged ${release}`); process.exit(0) }

/* Quit any running copy of the installed app, then swap the bundle atomically. */
const running = spawnSync('pgrep', ['-f', path.join(target, 'Contents/MacOS/Foundation')], { encoding: 'utf8' }).stdout.trim()
if (running) {
  console.log('\nQuitting running Foundation…')
  spawnSync('osascript', ['-e', 'tell application "Foundation" to quit'], { stdio: 'ignore' })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline && spawnSync('pgrep', ['-f', path.join(target, 'Contents/MacOS/Foundation')]).status === 0) await new Promise(resolve => setTimeout(resolve, 250))
  if (spawnSync('pgrep', ['-f', path.join(target, 'Contents/MacOS/Foundation')]).status === 0) throw new Error('Foundation is still running; close it and rerun')
}
await mkdir(path.dirname(target), { recursive: true })
const staged = `${target}.new-${stamp}`
run('ditto', [release, staged])
let previous
try { await access(target); previous = `${target}.previous-${stamp}`; await rename(target, previous) } catch (error) { if (error.code !== 'ENOENT') throw error }
await rename(staged, target)
if (previous) {
  const trashed = spawnSync('trash', [previous], { stdio: 'ignore' }).status === 0
  if (!trashed) { await mkdir(path.join(os.homedir(), '.Trash'), { recursive: true }); await rename(previous, path.join(os.homedir(), '.Trash', path.basename(previous))) }
}
console.log(`\nInstalled ${target}\n  from ${release}`)
if (values['open']) run('open', [target])
