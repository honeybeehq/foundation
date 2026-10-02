#!/usr/bin/env node
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(cli, '..', '..')
const bundle = join(cli, 'dist', 'session.mjs')
const manifest = join(cli, 'dist', 'session.inputs.json')

function modifiedAt(path) {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

function isFresh() {
  if (modifiedAt(bundle) === null) return false
  let built
  try {
    built = JSON.parse(readFileSync(manifest, 'utf8'))
  } catch {
    return false
  }
  return built.inputs.every((input) => {
    const at = modifiedAt(join(root, input))
    return at !== null && at < built.startedAt
  })
}

function writeAtomic(path, data) {
  const temp = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(temp, data)
    renameSync(temp, path)
  } catch (err) {
    rmSync(temp, { force: true })
    throw err
  }
}

async function build() {
  const startedAt = Date.now()
  const esbuild = await import('esbuild')
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: [join(cli, 'src', 'session', 'bin.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['loro-crdt'],
    write: false,
    metafile: true,
    logLevel: 'silent',
  })
  mkdirSync(dirname(bundle), { recursive: true })
  writeAtomic(bundle, result.outputFiles[0].contents)
  writeAtomic(manifest, JSON.stringify({ startedAt, inputs: [...Object.keys(result.metafile.inputs), 'pnpm-lock.yaml'] }))
}

try {
  if (!isFresh()) await build()
  const { main } = await import(pathToFileURL(bundle).href)
  process.exit(await main(process.argv.slice(3)))
} catch (err) {
  process.stderr.write(`internal error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
  process.exit(1)
}
