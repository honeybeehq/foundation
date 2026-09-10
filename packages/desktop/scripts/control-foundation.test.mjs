import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs, atPath, bounded, main } from './control-foundation.mjs'

test('rejects misspelled target options and invalid clients before touching an instance', () => {
  for (const args of [['launch', '--rn', '/tmp/x'], ['state', '--client', 'c'], ['launch', '--clients', '3'], ['click', '--input', 'direct-api'], ['state', '--run'], ['state', '--run', 'a', '--run', 'b']]) {
    assert.throws(() => parseArgs(args))
  }
  assert.deepEqual(parseArgs(['fill', '--run', '/tmp/with spaces', '--', '#text-content', '--literal value']), {
    command: 'fill', args: ['#text-content', '--literal value'], flags: { run: '/tmp/with spaces' },
  })
})

test('shared-document launches take a Comb configuration, document id and recover switch', () => {
  assert.deepEqual(parseArgs(['launch', '--run', '/tmp/r', '--comb-config', '/tmp/comb/config.toml', '--doc-id', 'remote-test.1', '--recover', '--author', 'user:b']).flags, {
    run: '/tmp/r', 'comb-config': '/tmp/comb/config.toml', 'doc-id': 'remote-test.1', recover: true, author: 'user:b',
  })
  assert.throws(() => parseArgs(['launch', '--run', '/tmp/r', '--recover']), /requires --doc-id/)
  assert.throws(() => parseArgs(['launch', '--run', '/tmp/r', '--doc-id', 'has space']), /doc-id/)
})

test('stored-state assertions distinguish missing values, null, arrays and inherited properties', () => {
  assert.equal(atPath({ document: { body: [{ text: 'saved' }] } }, 'document.body.0.text'), 'saved')
  assert.equal(atPath({ document: null }, 'document'), null)
  assert.equal(atPath({ document: null }, 'document.body'), undefined)
  assert.equal(atPath(Object.create({ pending: 0 }), 'pending'), undefined)
  assert.throws(() => atPath({}, '__proto__.polluted'))
})

test('bounded lifecycle fails on missing exit acknowledgement', async () => {
  assert.equal(await bounded(Promise.resolve('exited'), 100, 'missing exit'), 'exited')
  await assert.rejects(bounded(new Promise(() => {}), 5, 'missing exit'), /missing exit/)
})

test('launch requires explicit source runtime; help is machine readable', async () => {
  await assert.rejects(main(['launch', '--run', '/unused']), /requires --runtime/)
  assert.match((await main(['help'])).help, /wait-state/)
})
