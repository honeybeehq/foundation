import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDoctor } from '../src/commands/doctor.js'
import { captureIo } from '../src/io.js'

let home: string
function put(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'foundation-doctor-'))
  vi.stubEnv('HOME', home)
  vi.stubEnv('PATH', join(home, 'bin'))
  vi.stubEnv('FOUNDATION_GATEWAY_DIR', join(home, '.hive/gateways'))
})
afterEach(() => { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) })

describe('doctor inventory', () => {
  it('inspects PATH, local bin and gateway without executing discovered code or exposing secrets', async () => {
    const binary = join(home, 'bin/foundation')
    const marker = join(home, 'executed')
    put(binary, `#!/bin/sh\ntouch '${marker}'\n`)
    chmodSync(binary, 0o755)
    mkdirSync(join(home, '.local/bin'), { recursive: true })
    symlinkSync(binary, join(home, '.local/bin/foundation'))
    const registry = join(home, '.hive/gateways/foundation.json')
    const raw = JSON.stringify({ name: 'foundation', shim: { command: binary, args: ['mcp'] }, env: { SECRET: 'do-not-print' } })
    put(registry, raw)
    const io = captureIo()
    expect(await runDoctor(['--inventory', '--json'], io)).toBe(0)
    const result = JSON.parse(io.out[0]!)
    expect(result.readOnly).toBe(true)
    expect(result.entries.map((entry: { source: string }) => entry.source)).toEqual(['PATH', 'local-bin', 'gateway-registry'])
    expect(result.entries.every((entry: { realpath: string; sourceSha: null; artboardWriteSafe: string }) =>
      entry.realpath === binary && entry.sourceSha === null && entry.artboardWriteSafe === 'unknown')).toBe(true)
    expect(existsSync(marker)).toBe(false)
    expect(io.out.join('')).not.toContain('do-not-print')
    expect(readFileSync(registry, 'utf8')).toBe(raw)
  })

  it('reads versioned install stamps and known Cell config files only', async () => {
    const root = join(home, '.local/share/foundation/versions/build')
    const binary = join(root, 'packages/cli/src/main.ts')
    put(binary, '#!/usr/bin/env node\n')
    const sha = 'a'.repeat(40)
    put(join(root, 'foundation-install.json'), JSON.stringify({ runtime: { sourceSha: sha, artboardWriteSafe: true } }))
    put(join(home, '.hive/v2/cells/cell/.mcp.json'), JSON.stringify({ mcpServers: { foundation: { command: binary } } }))
    // A checkout nested in the Cell is deliberately outside config inventory.
    put(join(home, '.hive/v2/cells/cell/repo/.mcp.json'), '{"secret":"not-read"}')
    put(join(home, '.hive/v2/cells/cell/.codex/config.toml'), `[mcp_servers.foundation]\ncommand = '${binary}'\n[mcp_servers.other]\ncommand = '/not-found'\n`)
    const io = captureIo()
    await runDoctor(['--inventory', '--json'], io)
    const result = JSON.parse(io.out[0]!)
    expect(result.entries).toContainEqual(expect.objectContaining({ realpath: binary, sourceSha: sha, artboardWriteSafe: true }))
    expect(result.entries.filter((entry: { sourceSha: string }) => entry.sourceSha === sha)).toHaveLength(2)
    expect(result.coverage.commandsExecuted).toBe(false)
    expect(result.configs.some((config: { path: string }) => config.path.includes('/repo/'))).toBe(false)
  })

  it('reports missing and malformed inputs without changing them', async () => {
    const registry = join(home, '.hive/gateways/foundation.json')
    put(registry, '{invalid')
    const io = captureIo()
    expect(await runDoctor(['--inventory', '--json'], io)).toBe(0)
    const result = JSON.parse(io.out[0]!)
    expect(result.entries[0]).toMatchObject({ source: 'local-bin', realpath: null, sourceSha: null, artboardWriteSafe: 'unknown' })
    expect(result.configs[0].status).toBe('unsupported or malformed config')
    expect(readFileSync(registry, 'utf8')).toBe('{invalid')
  })

  it('requires the explicit inventory JSON mode', async () => {
    const io = captureIo()
    expect(await runDoctor([], io)).toBe(2)
    expect(io.out).toEqual([])
  })
})
