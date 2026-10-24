// Run with: node tests/replica-cli-proof.mjs
// Separate real CLI processes simulate two machines; no in-process chain API.
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const dir = mkdtempSync(join(tmpdir(), 'foundation-replicas-'))
const cli = resolve('packages/cli/src/main.ts')
function run(origin, ...args) {
  console.log(`$ FOUNDATION_ORIGIN_NODE=${origin} foundation ${args.join(' ')}`)
  const result = spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {
    env: { ...process.env, FOUNDATION_ORIGIN_NODE: origin }, encoding: 'utf8',
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stdout.write(result.stderr)
  assert.equal(result.status, 0, `CLI failed: ${result.error ?? result.stderr}`)
  return result.stdout
}
try {
  const a = join(dir, 'studio.fdn.html')
  const b = join(dir, 'satellite.fdn.html')
  const shared = join(dir, 'shared')
  run('Studio', 'new', a.replace(/\.fdn\.html$/, ''), '--author', 'user:alice')
  copyFileSync(a, b)
  copyFileSync(`${a}.chain`, `${b}.chain`)
  const insertedIds = []
  for (const [file, origin, author, token, comment] of [
    [a, 'Studio', 'user:alice', 'studio-edit', 'Spacing from Studio'],
    [b, 'metal-3', 'user:bob', 'satellite-edit', 'Colour from metal-3'],
  ]) {
    run(origin, 'edit', file, '--author', author, '--label', `${origin} independent edit`,
      '--ops', JSON.stringify([{ op: 'set-token', name: token, value: '1' }]))
    run(origin, 'annotate', file, '--author', author, '--node', 'n1', '--text', comment)
    // Agent-style source insertion: the writer, not this proof, mints the missing id.
    console.log(`Insert source on ${origin}: <p>Inserted from ${origin}</p> (no id supplied)`)
    writeFileSync(file, readFileSync(file, 'utf8').replace('</main>', `<p>Inserted from ${origin}</p></main>`))
    run(origin, 'ingest', file, '--commit', '--author', author, '-m', `${origin} independent insert`)
    const inserted = [...readFileSync(file, 'utf8').matchAll(/<p\b([^>]*)>\s*Inserted from (Studio|metal-3)\s*<\/p>/g)]
    assert.equal(inserted.length, 1)
    insertedIds.push(/data-fdn-id="([^"]+)"/.exec(inserted[0][1])[1])
    console.log(inserted[0][0])
  }
  assert.equal(new Set(insertedIds).size, 2, 'offline writers must mint distinct node ids')
  for (const [file, origin] of [[a, 'Studio'], [b, 'metal-3'], [a, 'Studio']]) run(origin, 'chain', 'sync', file, shared)
  for (const [file, origin] of [[a, 'Studio'], [b, 'metal-3']]) {
    const annotations = run(origin, 'annotations', file).trim().split('\n')
    assert.equal(annotations.length, 2)
    assert.equal(new Set(annotations.map(line => line.split(' ')[1])).size, 2)
    assert(annotations.some(line => line.endsWith('Colour from metal-3')))
    assert(annotations.some(line => line.endsWith('Spacing from Studio')))
    const inserted = [...readFileSync(file, 'utf8').matchAll(/<p\b([^>]*)>\s*Inserted from (Studio|metal-3)\s*<\/p>/g)]
    assert.equal(inserted.length, 2)
    assert.deepEqual(inserted.map(match => match[2]).sort(), ['Studio', 'metal-3'])
    assert.deepEqual(inserted.map(match => /data-fdn-id="([^"]+)"/.exec(match[1])[1]).sort(), [...insertedIds].sort())
    console.log(`CLI-generated source on ${origin} after sync:`)
    for (const match of inserted) console.log(match[0])
    const page = JSON.parse(run(origin, 'chain', file, 'log', '--json'))
    for (const [author, node] of [['user:alice', 'Studio'], ['user:bob', 'metal-3']]) {
      assert(page.entries.some(entry => entry.author === author && entry.originNode === node && entry.message.includes('independent edit')))
      assert(page.entries.some(entry => entry.author === author && entry.originNode === node && entry.message.includes('annotate')))
      assert(page.entries.some(entry => entry.author === author && entry.originNode === node && entry.message.includes('independent insert') && entry.nodes.inserted.some(id => insertedIds.includes(id))))
    }
    run(origin, 'chain', file, 'log')
    run(origin, 'chain', file, 'verify')
  }
  console.log('PASS: both offline nodes and both comments survive on both copies; history shows both authors and origins.')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log('CLI proof exit status: 0')
