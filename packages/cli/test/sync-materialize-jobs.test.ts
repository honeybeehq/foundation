import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { acceptMaterialize, materializeStatus, processMaterializeJobs } from '../src/sync/materialize-jobs.js'

let root: string
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); if (root) rmSync(root, { recursive: true, force: true }) })
it('accepts idempotently without network and settles missing-checkout refusal in the daemon', async () => {
  root = mkdtempSync(join(tmpdir(), 'materialize-jobs-')); vi.stubEnv('FOUNDATION_REPLICA_STORE', join(root, 'store'))
  const fetcher = vi.fn(() => { throw new Error('network forbidden') }); vi.stubGlobal('fetch', fetcher)
  const request = { workspaceId: 'w', productId: 'p', docId: 'doc', checkoutRoot: join(root, 'missing'), requestKey: 'open-on-this-machine', repoRelativePath: 'board.fdn.html' }
  expect(acceptMaterialize(request)).toEqual({ version: 1, state: 'accepted', requestKey: request.requestKey })
  expect(acceptMaterialize(request).state).toBe('accepted')
  expect(() => acceptMaterialize({ ...request, targetPath: 'other.fdn.html' })).toThrow('different materialization')
  expect(materializeStatus(request.requestKey).state).toBe('pending')
  expect(fetcher).not.toHaveBeenCalled()
  mkdirSync(join(root,'store/read-model/materialize/requests'),{recursive:true})
  writeFileSync(join(root,'store/read-model/materialize/requests','0'.repeat(64)+'.json'),'{broken')
  const controller = new AbortController(), run = processMaterializeJobs(controller.signal, () => {})
  try {
    const start = Date.now()
    while (materializeStatus(request.requestKey).state === 'pending') {
      if (Date.now() - start > 3000) throw new Error('job did not settle')
      await new Promise(done => setTimeout(done, 10))
    }
    expect(materializeStatus(request.requestKey)).toMatchObject({ version: 1, state: 'refused', code: 'product-unavailable', requestKey: request.requestKey })
    expect(fetcher).not.toHaveBeenCalled()
  } finally { controller.abort(); await run }
})
