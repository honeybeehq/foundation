import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const script = fileURLToPath(new URL('./deploy.mjs', import.meta.url))

for (const [flag, error] of [['--target', /ERR_PARSE_ARGS_INVALID_OPTION_VALUE/], ['--no-instal', /Unknown option/]]) {
  test(`deploy rejects ${flag} before runtime lookup or install`, () => {
    // This missing runtime makes even the unfixed script stop before any build/install.
    const result = spawnSync(process.execPath, [script, '--runtime', '/nonexistent-foundation-test-runtime', flag], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, error)
    assert.doesNotMatch(result.stdout, /Foundation desktop deploy/)
  })
}
