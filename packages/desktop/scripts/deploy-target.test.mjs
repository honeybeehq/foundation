import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Script } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import path from 'node:path'

const moduleURL = new URL('./deploy.mjs', import.meta.url).href
const source = (await readFile(new URL('./deploy.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*$/gm, '').replaceAll('import.meta.url', 'moduleURL')

// Execute the real entry-point body with virtual filesystem/process boundaries.
// No app is built, installed, signalled or launched by this fixture.
async function deploy({ target, processes, nameTarget }) {
  const alive = new Set(processes), quitTargets = [], commands = []
  let clock = 0
  class Clock extends Date { static now() { return clock += 11_000 } }
  const context = {
    moduleURL, fileURLToPath, URL, path, Date: Clock,
    os: { homedir: () => '/fixture-user' },
    process: { exit: code => { throw new Error(`Unexpected process.exit(${code})`) } },
    console: { log() {} }, setTimeout: callback => callback(),
    parseArgs: options => parseArgs({ ...options, args: ['--runtime', '/fixture-runtime', '--target', target] }),
    access: async () => {}, mkdir: async () => {}, rename: async () => {}, readFile: async () => '',
    execFileSync: (_command, args) => args[0] === 'rev-parse' ? 'fixture-head\n' : '',
    spawnSync(command, args) {
      commands.push({ command, args })
      if (command === 'pgrep') {
        const matches = [...alive].filter(value => new RegExp(args[1]).test(value))
        return { status: matches.length ? 0 : 1, stdout: matches.length ? '123\n' : '' }
      }
      if (command === 'osascript') {
        // The old name-only request resolves to another installed copy.
        // Path supplied as argv instead explicitly selects the requested copy.
        const requested = args.at(-1).startsWith('/') ? args.at(-1) : nameTarget
        quitTargets.push(requested)
        for (const value of alive) if (value === `${requested}/Contents/MacOS/Foundation` || value.startsWith(`${requested}/Contents/MacOS/Foundation `)) alive.delete(value)
      }
      return { status: 0, stdout: '' }
    },
  }
  let error
  try { await new Script(`(async () => {${source}\n})()`).runInNewContext(context) }
  catch (caught) { error = caught.message }
  return { error, alive, quitTargets, commands }
}

test('custom target requests Quit for that path and preserves another installed copy', async () => {
  const target = '/tmp/Owned Foundation.app', other = '/tmp/Other Foundation.app'
  const result = await deploy({ target, nameTarget: other, processes: [`${target}/Contents/MacOS/Foundation --replica-dir /fixture`, `${other}/Contents/MacOS/Foundation`] })
  assert.deepEqual(result.quitTargets, [target])
  assert.equal(result.error, undefined)
  assert.deepEqual([...result.alive], [`${other}/Contents/MacOS/Foundation`])
})

test('process lookup treats target path characters literally', async () => {
  const target = '/tmp/Foundation.app', other = '/tmp/FoundationXapp'
  const result = await deploy({ target, nameTarget: other, processes: [`${other}/Contents/MacOS/Foundation`] })
  assert.deepEqual(result.quitTargets, [])
  assert.equal(result.error, undefined)
  assert.deepEqual([...result.alive], [`${other}/Contents/MacOS/Foundation`])
})

test('process lookup ignores a target executable mentioned only in another command arguments', async () => {
  const target = '/tmp/Foundation.app', unrelated = `/usr/bin/node fixture.mjs ${target}/Contents/MacOS/Foundation`
  const result = await deploy({ target, nameTarget: '/tmp/Other.app', processes: [unrelated] })
  assert.deepEqual(result.quitTargets, [])
  assert.equal(result.error, undefined)
  assert.deepEqual([...result.alive], [unrelated])
})
