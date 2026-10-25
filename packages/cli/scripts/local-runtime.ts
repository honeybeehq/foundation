/** Build a stamped, explicitly selected test runtime without installing into HOME. */
import { build } from 'esbuild'
import { mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { sourceRoot, runtimeVersion } from '../src/runtime-version.js'
const out = process.argv[2]
if (!out || !isAbsolute(out)) throw new Error('usage: pnpm exec tsx packages/cli/scripts/local-runtime.ts ABS_EMPTY_DIRECTORY')
mkdirSync(out, { recursive: true })
if (readdirSync(out).length) throw new Error('local runtime destination must be empty')
const runtime = runtimeVersion(sourceRoot)
await build({ entryPoints: [join(sourceRoot, 'packages/cli/src/capabilities-bin.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: join(out, 'capabilities.mjs') })
const quote = (s: string): string => "'" + s.replace(/'/g, "'\\''") + "'"
writeFileSync(join(out, 'foundation'), `#!/bin/sh
FDN_ROOT=${quote(sourceRoot)}
export FDN_ROOT
if [ "$1" = doctor ]; then
  for arg in "$@"; do
    if [ "$arg" = --capabilities ]; then shift; exec ${quote(process.execPath)} ${quote(join(out, 'capabilities.mjs'))} "$@"; fi
  done
fi
exec ${quote(process.execPath)} ${quote(join(sourceRoot, 'node_modules/tsx/dist/cli.mjs'))} ${quote(join(sourceRoot, 'packages/cli/src/main.ts'))} "$@"
`, { mode: 0o755, flag: 'wx' })
symlinkSync(join(sourceRoot, 'packages'), join(out, 'packages'), 'dir')
writeFileSync(join(out, 'foundation-install.json'), JSON.stringify({ kind: 'isolated-source-runtime', runtime, sourceRoot, builtAt: new Date().toISOString() }, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ kind: 'isolated-source-runtime', path: join(out, 'foundation'), sourceSha: runtime.sourceSha, dirty: runtime.dirty }))
