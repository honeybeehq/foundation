import { expect, it } from 'vitest'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { localCombConfiguration, options } from '../src/runtime.js'

it('preserves the local Comb key and configuration across startup', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'foundation-desktop-runtime-'))
  const config = path.join(directory, 'comb'), objects = path.join(directory, 'objects with spaces')
  await localCombConfiguration(config, objects)
  const first = await readFile(path.join(config, 'config.toml'), 'utf8')
  expect(first).toMatch(/digest_key = "[a-f0-9]{64}"/)
  expect(first).toContain(`root = ${JSON.stringify(objects)}`)
  expect((await stat(path.join(config, 'config.toml'))).mode & 0o777).toBe(0o600)
  await localCombConfiguration(config, path.join(directory, 'should-not-overwrite'))
  expect(await readFile(path.join(config, 'config.toml'), 'utf8')).toBe(first)
})

it('parses independent instance directories and recovery without accepting missing values', () => {
  const args = options(['electron', '.', '--replica-dir', '/replica A', '--doc-id=test', '--recover'])
  expect(args.get('replica-dir')).toBe('/replica A'); expect(args.get('doc-id')).toBe('test'); expect(args.get('recover')).toBe('true')
  expect(() => options(['--host-url', '--doc-id', 'test'])).toThrow('Missing value')
})
