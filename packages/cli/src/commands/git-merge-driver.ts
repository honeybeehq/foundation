/** Git passes temporary paths; %P identifies the sibling chains in Git objects. */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { loadChain, mergeChains } from 'foundation-engine'
import type { CliIO } from '../io.js'
import { projectedText, projectionVersion } from '../disk.js'
import { readDocIdAttr } from '../docid.js'

function gitBytes(object: string): Buffer | null {
  try { return execFileSync('git', ['show', object], { maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) }
  catch { return null }
}

/** Match object chains to the actual temporary HTML sides, never to labels
 * alone. During a merge MERGE_HEAD may not exist yet; Git passes incoming
 * commit IDs as GITHEAD_<sha> environment keys. Operation heads and index
 * stages cover rebase/cherry-pick; every candidate must match the HTML. */
function sideChain(html: Buffer, path: string): Uint8Array {
  const text = html.toString('utf8')
  const incoming = Object.keys(process.env).filter(key => /^GITHEAD_[0-9a-f]{40,64}$/.test(key)).map(key => key.slice(8))
  // Rebase writes the active pick to done before invoking the merge driver,
  // but may not create REBASE_HEAD until a conflict has already occurred.
  let activePick: string | undefined
  try {
    const donePath = execFileSync('git', ['rev-parse', '--git-path', 'rebase-merge/done'], { encoding: 'utf8' }).trim()
    const line = readFileSync(donePath, 'utf8').trim().split('\n').at(-1)
    activePick = /^(?:pick|p|reword|r|edit|e|squash|s|fixup|f) ([0-9a-f]{7,64})\b/.exec(line ?? '')?.[1]
  } catch { /* no active merge-backend rebase */ }
  const refs = [activePick, ':2', ':3', 'HEAD', 'MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'FETCH_HEAD', 'ORIG_HEAD', ...incoming].filter((ref): ref is string => !!ref)
  for (const ref of refs) {
    const bytes = gitBytes(`${ref}:${path}.chain`)
    if (!bytes) continue
    const chain = loadChain(bytes)
    if (chain.docId() === readDocIdAttr(text) && chain.versionRef() === projectionVersion(text) && projectedText(chain) === text) return bytes
  }
  throw new Error(`cannot identify the chain matching ${path}; resolve the chain and regenerate the projection manually`)
}

export async function runGitMergeDriver(args: string[], io: CliIO): Promise<number> {
  const [ancestor, ours, theirs, repoPath] = args
  if (!ancestor || !ours || !theirs) {
    io.stderr('usage: foundation git-merge-driver <ancestor> <ours> <theirs> [repo-path]')
    return 2
  }
  try {
    const a = readFileSync(ours), b = readFileSync(theirs)
    const html = repoPath ? repoPath.endsWith('.fdn.html') : a.toString('utf8').includes('<fdn-doc')
    if (html && !repoPath) throw new Error('HTML merge requires Git %P; run foundation git setup')
    const left = html ? sideChain(a, repoPath!) : a
    const right = html ? sideChain(b, repoPath!) : b
    if (loadChain(left).docId() !== loadChain(right).docId()) throw new Error('cannot merge different document identities')
    const { merged, overlaps } = mergeChains(left, right)
    writeFileSync(ours, html ? projectedText(loadChain(merged)) : merged)
    for (const line of overlaps.lines) io.stderr(`concurrent-overlap: ${line.message}`)
    return 0
  } catch (error) {
    io.stderr(`git-merge-driver: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}
