import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { runtimeVersion } from '../src/runtime-version.js'

describe('runtime attestation', () => {
  it('reports unknown without git and stamps immutable installed metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'foundation-version-'))
    try {
      expect(runtimeVersion(root).sourceSha).toBe('unknown')
      expect(runtimeVersion(root).dirty).toBe(null)
      const runtime = { ...runtimeVersion(root), sourceSha: 'a'.repeat(40), dirty: false }
      writeFileSync(join(root, 'foundation-install.json'), JSON.stringify({ runtime }))
      expect(runtimeVersion(root)).toEqual(runtime)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('resolves HEAD and dirty state from the specified checkout', () => {
    const root = mkdtempSync(join(tmpdir(), 'foundation-version-'))
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
    try {
      git('init', '-q'); git('config', 'user.name', 'test'); git('config', 'user.email', 'test@example.com')
      mkdirSync(join(root, 'packages/cli'), { recursive: true })
      writeFileSync(join(root, 'packages/cli/package.json'), '{"version":"1.2.3"}')
      git('add', '.'); git('commit', '-qm', 'fixture')
      expect(runtimeVersion(root)).toMatchObject({ sourceSha: git('rev-parse', 'HEAD'), dirty: false, packageVersion: '1.2.3', sessionProtocols: ['0.2', '0.1'], documentFormats: ['0.1.0-artboards', '0.0.1-draft', '0.1.0', '0.2.0'] })
      writeFileSync(join(root, 'changed'), 'yes')
      expect(runtimeVersion(root).dirty).toBe(true)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})

it('does not discover an ancestor repository from an archive stage', () => {
  const root = mkdtempSync(join(tmpdir(), 'foundation-ancestor-'))
  try {
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
    git('init', '-q'); git('config', 'user.name', 'test'); git('config', 'user.email', 'test@example.com')
    writeFileSync(join(root, 'tracked'), 'original'); git('add', '.'); git('commit', '-qm', 'fixture')
    const stage = join(root, 'versions', 'stage'); mkdirSync(stage, { recursive: true })
    expect(runtimeVersion(stage)).toMatchObject({ sourceSha: 'unknown', dirty: null })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
