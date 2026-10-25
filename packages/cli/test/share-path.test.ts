import { mkdtempSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { shareStateDir } from '../src/share/share-path.js'
import { readVault } from '../src/share/vault.js'
let root: string
afterEach(() => { vi.unstubAllEnvs(); if (root) rmSync(root, { recursive: true, force: true }) })
it('isolates sharing state in an absolute private directory without changing HOME', () => {
  root = mkdtempSync(join(tmpdir(), 'share-state-'))
  const home = process.env.HOME, state = join(root, 'state')
  vi.stubEnv('FOUNDATION_SHARE_STATE_DIR', state)
  expect(shareStateDir()).toBe(state); expect(statSync(state).mode & 0o777).toBe(0o700)
  if (process.platform !== 'darwin') expect(readVault().sessions).toEqual({})
  expect(process.env.HOME).toBe(home)
  vi.stubEnv('FOUNDATION_SHARE_STATE_DIR', 'relative')
  expect(() => shareStateDir()).toThrow('must be absolute')
  const link = join(root, 'link'); symlinkSync(state, link)
  vi.stubEnv('FOUNDATION_SHARE_STATE_DIR', link)
  expect(() => shareStateDir()).toThrow('private')
})
