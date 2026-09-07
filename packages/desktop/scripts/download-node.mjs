import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const name = 'node-v24.20.0-darwin-arm64.tar.gz'
const expected = '40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8'
const root = fileURLToPath(new URL('../.runtime-downloads/', import.meta.url))
await mkdir(root, { recursive: true })
const origin = 'https://nodejs.org/dist/v24.20.0/'
const sums = await (await fetch(`${origin}SHASUMS256.txt`)).text()
if (!sums.includes(`${expected}  ${name}`)) throw new Error('Official Node checksum differs from pinned runtime')
const target = path.join(root, name)
let bytes
try { bytes = await readFile(target) }
catch {
  const response = await fetch(`${origin}${name}`)
  if (!response.ok) throw new Error(`Node download failed (${response.status})`)
  bytes = Buffer.from(await response.arrayBuffer())
}
if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Node archive checksum mismatch')
await writeFile(target, bytes)
await writeFile(path.join(root, 'SHASUMS256.txt'), sums)
execFileSync('tar', ['-xzf', target, '-C', root])
console.log(path.join(root, name.replace('.tar.gz', ''), 'bin/node'))
