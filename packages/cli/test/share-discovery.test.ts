import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { findShareRoot } from '../src/share/config.js'
let root: string
function fixture() {
  root = mkdtempSync(join(tmpdir(), 'share-discovery-'))
  const home = join(root, 'home'), child = join(home, 'work', 'designs')
  mkdirSync(child, { recursive: true })
  vi.stubEnv('HOME', home)
  vi.stubEnv('GIT_CEILING_DIRECTORIES', '')
  return { home, child }
}
function share(path: string) {
  mkdirSync(join(path, '.foundation'), { recursive: true })
  writeFileSync(join(path, '.foundation/share.json'), '{}')
}
afterEach(() => { vi.unstubAllEnvs(); if (root) rmSync(root, { recursive:true,force:true }) })
it('does not discover config or Git roots at or above any Git ceiling', () => {
  const {home, child} = fixture()
  share(home)
  vi.stubEnv('GIT_CEILING_DIRECTORIES', [join(root, 'other'), join(home, 'work')].join(delimiter))
  expect(findShareRoot(child)).toBe(null)
  mkdirSync(join(home, 'work', '.git'))
  expect(findShareRoot(child)).toBe(null)
})
it('does not walk beyond HOME into an ancestor repository', () => {
  const {child} = fixture(); share(root)
  expect(findShareRoot(child)).toBe(null)
})
it('still discovers a config below the boundary', () => {
  const {home, child} = fixture(); share(join(home, 'work'))
  expect(findShareRoot(child)).toBe(realpathSync(join(home, 'work')))
})

it('applies ceilings through symlinked paths', () => {
  const {home, child} = fixture(); share(home)
  const alias = join(root, 'alias'); symlinkSync(home, alias)
  vi.stubEnv('GIT_CEILING_DIRECTORIES', join(alias, 'work'))
  expect(findShareRoot(child)).toBe(null)
  expect(findShareRoot(join(alias, 'work', 'designs'))).toBe(null)
})
