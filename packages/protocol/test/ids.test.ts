import { describe, expect, it, vi } from 'vitest'
import { mintAnnotationId, mintNodeId } from '../src/session.ts'
import { mintNodeId as engineNode, mintAnnotationId as engineAnnotation } from '../../engine/src/index.js'

describe('shared browser-safe replica ids', () => {
  it('uses the same minters in protocol and engine without Math.random', () => {
    expect(engineNode).toBe(mintNodeId)
    expect(engineAnnotation).toBe(mintAnnotationId)
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('weak random') })
    try {
      const ids = Array.from({ length: 100 }, () => [mintNodeId(), mintAnnotationId()]).flat()
      expect(new Set(ids).size).toBe(200)
      for (const id of ids) expect(id).toMatch(/^[na]-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
    } finally { random.mockRestore() }
  })
  it('explains the missing secure random source', () => {
    vi.stubGlobal('crypto', undefined)
    try { expect(() => mintNodeId()).toThrow('requires Web Crypto') }
    finally { vi.unstubAllGlobals() }
  })

})
