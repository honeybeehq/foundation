import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createChain, projectDocument } from 'foundation-engine'
import { skeletonDocument } from '../src/commands/new.js'
import { registerDesign, closeDesign, autoOpenDesign, liveDesigns } from '../src/sync-store.js'
let dir: string | undefined
afterEach(() => { vi.unstubAllEnvs(); if (dir) rmSync(dir, { recursive: true, force: true }) })
it('preserves an explicit address on auto-open, and an edit can reopen a closed copy', () => {
  dir = mkdtempSync(join(tmpdir(), 'sync-store-')); vi.stubEnv('FOUNDATION_REPLICA_STORE', join(dir, 'store')); vi.stubEnv('FOUNDATION_SYNC_AUTO_OPEN', '1')
  const file = join(dir, 'board.fdn.html'), doc = skeletonDocument('Board')
  writeFileSync(file, projectDocument(doc)); writeFileSync(`${file}.chain`, createChain(doc, { author: 'test', message: 'init' }, { docId: 'board' }).save())
  registerDesign(file, 'explicit-workspace', 'explicit-product'); autoOpenDesign(file, () => {})
  expect(liveDesigns()).toHaveLength(1); expect(liveDesigns()[0]?.workspace).toBe('explicit-workspace')
  closeDesign(file); expect(liveDesigns()).toEqual([])
  autoOpenDesign(file, () => {}); expect(liveDesigns()).toHaveLength(1)
})
it('isolates a malformed registry entry', () => {
  dir = mkdtempSync(join(tmpdir(), 'sync-store-')); vi.stubEnv('FOUNDATION_REPLICA_STORE', dir)
  mkdirSync(join(dir, 'live')); writeFileSync(join(dir, 'live', 'bad.json'), '{bad')
  const errors: string[] = []; expect(liveDesigns(message => errors.push(message))).toEqual([]); expect(errors[0]).toContain('bad.json')
})
