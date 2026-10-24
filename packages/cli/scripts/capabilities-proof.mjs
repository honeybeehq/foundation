import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { hostname, loadavg, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const source = process.argv.includes('--source')
const outIndex = process.argv.indexOf('--out')
const out = resolve(outIndex < 0 ? '.audit/S6b/capabilities-receipt.json' : process.argv[outIndex + 1])
const fixture = mkdtempSync(join(tmpdir(), 'foundation-capabilities-'))
const home = join(fixture, 'home'), repo = join(fixture, 'repo'), bin = join(home, '.local/bin')
mkdirSync(bin, { recursive: true }); mkdirSync(repo)
const env = { ...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin`, FOUNDATION_NODE_ID: 'capability-fixture' }
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env }).trim()
git('init', '-q'); git('-c', 'user.name=proof', '-c', 'user.email=proof@invalid', 'commit', '--allow-empty', '-qm', 'fixture')
const head = git('rev-parse', 'HEAD')
const design = join(repo, 'working tree only.fdn.html')
writeFileSync(design, '<!doctype html><title>Uncommitted local design</title>')
const entry = join(fixture, 'capabilities.mjs')
await build({ entryPoints: [join(root, 'packages/cli/src/capabilities-bin.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: entry })
const prefix = source ? [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'packages/cli/src/main.ts'), 'doctor'] : [entry]
const args = ['--capabilities', '--json', '--product-root', repo, '--design-path', design]
const cases = []
function run(name, argv = args, overrides = {}, status = 0) {
  const started = process.hrtime.bigint()
  const result = spawnSync(process.execPath, [...prefix, ...argv], { env: { ...env, ...overrides }, encoding: 'utf8', timeout: 5000 })
  const ms = Number(process.hrtime.bigint() - started) / 1e6
  assert.equal(result.status, status, `${name}: ${result.stderr}`)
  const lines = result.stdout.trim().split('\n')
  if (status === 0) assert.equal(lines.length, 1, `${name}: one JSON line`)
  else assert.equal(result.stdout, '', `${name}: no partial JSON on invalid input`)
  const value = status === 0 ? JSON.parse(lines[0]) : null
  cases.push({ name, ms, status: result.status, stdout: result.stdout, stderr: result.stderr })
  return { ms, value }
}
let value = run('no installed runtime').value
assert.equal(value.foundation.installed, false); assert.equal(value.foundation.sourceSha, null)
assert.equal(value.checkout.present, true); assert.equal(value.checkout.head, head); assert.equal(value.checkout.designPresent, true)
assert.equal(git('ls-files', '--', design), '')
const marker = join(home, 'discovered-command-was-executed')
const legacyBin = join(bin, 'foundation')
writeFileSync(legacyBin, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 })
value = run('unstamped installed runtime').value
assert.equal(value.foundation.installed, true); assert.equal(value.foundation.path, realpathSync(legacyBin))
for (const key of ['sourceSha', 'sessionProtocols', 'documentFormats', 'artboardWriteSafe', 'quickrefPath']) assert.equal(value.foundation[key], null)
const release = join(home, '.local/share/foundation/versions', 'a'.repeat(40))
mkdirSync(release, { recursive: true })
const runtime = { sourceSha: 'a'.repeat(40), sessionProtocols: ['0.2', '0.1'], documentFormats: ['0.1.0-artboards'], artboardWriteSafe: true }
writeFileSync(join(release, 'foundation-install.json'), JSON.stringify({ runtime }))
const installed = join(release, 'foundation')
writeFileSync(installed, readFileSync(legacyBin), { mode: 0o755 })
const quickref = join(release, 'packages/cli/skills/foundation-edit/SKILL.md')
mkdirSync(dirname(quickref), { recursive: true }); writeFileSync(quickref, '# Quick edit fixture\n')
const preferred = join(fixture, 'preferred-bin'); mkdirSync(preferred); symlinkSync(installed, join(preferred, 'foundation'))
const installedEnv = { PATH: `${preferred}:/usr/bin:/bin`, GIT_DIR: join(fixture, 'wrong-git-dir'), GIT_WORK_TREE: fixture }
value = run('stamped runtime plus hostile inherited Git context', args, installedEnv).value
assert.equal(value.foundation.sourceSha, runtime.sourceSha); assert.equal(value.foundation.quickrefPath, realpathSync(quickref))
assert.deepEqual(value.foundation.sessionProtocols, runtime.sessionProtocols); assert.equal(value.foundation.artboardWriteSafe, true)
assert.equal(value.checkout.head, head); assert.equal(value.checkout.repoRoot, realpathSync(repo))
value = run('explicit artifact wins over older PATH runtime', [...args, '--foundation-path', installed]).value
assert.equal(value.foundation.path, realpathSync(installed)); assert.equal(value.foundation.sourceSha, runtime.sourceSha)
value = run('missing explicit runtime never falls back to PATH', [...args, '--foundation-path', join(fixture, 'missing-foundation')]).value
assert.equal(value.foundation.installed, false); assert.equal(value.foundation.path, null)
value = run('missing design', ['--capabilities', '--json', '--product-root', repo, '--design-path', join(repo, 'missing.fdn.html')], installedEnv).value
assert.equal(value.checkout.present, true); assert.equal(value.checkout.designPresent, false)
value = run('missing product checkout', ['--capabilities', '--json', '--product-root', join(fixture, 'missing'), '--design-path', design], installedEnv).value
assert.equal(value.checkout.present, false); assert.equal(value.checkout.designPresent, false)
const plain = join(fixture, 'plain'); mkdirSync(plain)
const plainFile = join(plain, 'design.fdn.html'); writeFileSync(plainFile, 'working-tree file')
value = run('existing non-Git directory', ['--capabilities', '--json', '--product-root', plain, '--design-path', plainFile], installedEnv).value
assert.equal(value.checkout.present, true); assert.equal(value.checkout.head, null); assert.equal(value.checkout.designPresent, true)
symlinkSync(plainFile, join(repo, 'escape.fdn.html'))
value = run('symlink outside explicit root', ['--capabilities', '--json', '--product-root', repo, '--design-path', join(repo, 'escape.fdn.html')], installedEnv).value
assert.equal(value.checkout.designPresent, false)
run('relative design rejected', ['--capabilities', '--json', '--product-root', repo, '--design-path', 'relative.fdn.html'], installedEnv, 2)
run('design without root rejected', ['--capabilities', '--json', '--design-path', design], installedEnv, 2)
run('unknown flag rejected', [...args, '--force'], installedEnv, 2)
assert.equal(existsSync(marker), false)
function snapshot(dir, path = '') {
  return readdirSync(join(dir, path)).sort().flatMap(name => {
    const rel = join(path, name), full = join(dir, rel), stat = lstatSync(full)
    if (stat.isDirectory()) return snapshot(dir, rel)
    return [{ path: rel, mode: stat.mode, value: stat.isSymbolicLink() ? realpathSync(full) : createHash('sha256').update(readFileSync(full)).digest('hex') }]
  })
}
const before = snapshot(fixture), loadBefore = loadavg(), samples = []
for (let i = 0; i < 20; i++) {
  const measured = run(`sample ${i + 1}`, args, installedEnv)
  assert.equal(measured.value.foundation.sourceSha, runtime.sourceSha)
  assert.equal(measured.value.checkout.designPresent, true)
  samples.push(measured.ms)
}
assert.deepEqual(snapshot(fixture), before)
assert.equal(existsSync(marker), false)
const sorted = [...samples].sort((a, b) => a - b)
const receipt = { workload: 'doctor-capabilities', seriesId: `${hostname()}-${process.version}-${source ? 'source' : 'built'}-capabilities-v1`, fixture, head: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  machine: hostname(), runtime: process.version, node: process.execPath, buildMode: source ? 'source' : 'built', loadBefore, loadAfter: loadavg(),
  command: [process.execPath, ...prefix, ...args], samples, p50: sorted[9], p95: sorted[18], max: sorted[19],
  results: [{ metric: 'commandP95', samples, invariantHolds: true }], cases, readonlyVerified: true, discoveredCommandsExecuted: false }
mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify({ receipt: out, fixture, buildMode: receipt.buildMode, cases: cases.length, p50: receipt.p50, p95: receipt.p95, max: receipt.max, readonlyVerified: true }))
