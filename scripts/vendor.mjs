import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2]
if (!target) {
  console.error('usage: node scripts/vendor.mjs <target directory>')
  process.exit(1)
}

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
if (git('status', '--porcelain')) {
  console.error('Commit your changes first: the pin names a commit.')
  process.exit(1)
}

const files = [
  ['packages/protocol/src/session.ts', 'session.ts'],
  ['packages/engine/src/types.ts', 'document.ts'],
]
const vendored = new Set(files.map(([, to]) => `./${to}`))
const specifiers = /(?:import|export)\s[^'"]*?from\s+'([^']+)'/g

const hash = createHash('sha256')
for (const [from, to] of files) {
  const text = readFileSync(join(root, from), 'utf8')
  for (const [, specifier] of text.matchAll(specifiers)) {
    if (!vendored.has(specifier)) {
      console.error(`${from} imports '${specifier}', which is not part of the vendored set`)
      process.exit(1)
    }
  }
  const out = join(resolve(target), to)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, text)
  hash.update(to).update(text)
}

const protocol = /export const SESSION_PROTOCOL = '([^']+)'/.exec(readFileSync(join(root, 'packages/protocol/src/session.ts'), 'utf8'))?.[1]
const pin = {
  repository: 'https://github.com/honeybeehq/foundation',
  commit: git('rev-parse', 'HEAD'),
  license: JSON.parse(readFileSync(join(root, 'packages/protocol/package.json'), 'utf8')).license,
  protocol,
  files: files.map(([, to]) => to),
  sha256: hash.digest('hex'),
}
writeFileSync(join(resolve(target), 'PIN.json'), `${JSON.stringify(pin, null, 2)}\n`)
console.log(`vendored Foundation session protocol ${pin.protocol} at ${pin.commit.slice(0, 10)} into ${resolve(target)}`)
