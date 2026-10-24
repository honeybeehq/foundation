import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { readTextIfPresent, writeAtomic } from '../disk.js'
import type { CliIO } from '../io.js'

export async function runGit(args: string[], io: CliIO): Promise<number> {
  if (args.length !== 1 || args[0] !== 'setup') { io.stderr('usage: foundation git setup'); return 2 }
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
    const path = join(root, '.gitattributes')
    let text = readTextIfPresent(path) ?? ''
    for (const rule of ['*.fdn.html.chain merge=foundation', '*.fdn.html merge=foundation']) {
      if (!text.split('\n').includes(rule)) text += `${text && !text.endsWith('\n') ? '\n' : ''}${rule}\n`
    }
    writeAtomic(path, text)
    const excludePath = execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'], { encoding: 'utf8' }).trim()
    let exclude = readTextIfPresent(excludePath) ?? ''
    for (const rule of ['*.fdn.html.chain.projection', '*.fdn.html.chain.pending', '*.fdn.html.lock', '*.fdn.html.lock.reap']) {
      if (!exclude.split('\n').includes(rule)) exclude += `${exclude && !exclude.endsWith('\n') ? '\n' : ''}${rule}\n`
    }
    writeAtomic(excludePath, exclude)
    for (const [key, value] of [['name', 'Foundation chain-aware merge'], ['driver', 'foundation git-merge-driver %O %A %B %P']] as const) {
      execFileSync('git', ['-C', root, 'config', '--local', `merge.foundation.${key}`, value])
    }
    io.stdout('Foundation Git merge driver configured')
    return 0
  } catch (error) { io.stderr(String(error)); return 1 }
}
