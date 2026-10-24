import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { readTextIfPresent, writeAtomic } from '../disk.js'
import { prepareGitUpdate, pullGit, recoverGitUpdate, warnPendingGitUpdates } from '../git-update.js'
import type { CliIO } from '../io.js'

export async function runGit(args: string[], io: CliIO): Promise<number> {
  if (!args.length) { io.stderr('usage: foundation git setup|pull|prepare-update|recover-update'); return 2 }
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
    if (args[0] !== 'recover-update') warnPendingGitUpdates(root, io)
    if (args[0] === 'pull') { pullGit(root, args.slice(1), io); return 0 }
    if (args[0] === 'prepare-update') {
      if (!args[1] || args[2] !== '--' || !args[3]) throw new Error('usage: foundation git prepare-update <incoming> -- <command> [args...]')
      prepareGitUpdate(root, args[1], args.slice(3), io); return 0
    }
    if (args[0] === 'recover-update') {
      if (!args[1] || args.length !== 2) throw new Error('usage: foundation git recover-update <backup-directory>')
      recoverGitUpdate(root, args[1]); io.stdout('Local design changes recovered; backup retained'); return 0
    }
    if (args[0] !== 'setup' || args.length !== 1) throw new Error('usage: foundation git setup|pull|prepare-update|recover-update')
    const path = join(root, '.gitattributes')
    let text = readTextIfPresent(path) ?? ''
    for (const rule of ['*.fdn.html.chain merge=foundation', '*.fdn.html merge=foundation']) {
      if (!text.split(/\r?\n/).includes(rule)) text += `${text && !text.endsWith('\n') ? '\n' : ''}${rule}\n`
    }
    writeAtomic(path, text)
    const excludePath = execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'], { encoding: 'utf8' }).trim()
    let exclude = readTextIfPresent(excludePath) ?? ''
    for (const rule of ['*.fdn.html.chain.projection', '*.fdn.html.chain.pending', '*.fdn.html.lock', '*.fdn.html.lock.reap']) {
      if (!exclude.split(/\r?\n/).includes(rule)) exclude += `${exclude && !exclude.endsWith('\n') ? '\n' : ''}${rule}\n`
    }
    writeAtomic(excludePath, exclude)
    for (const [key, value] of [['name', 'Foundation chain-aware merge'], ['driver', 'foundation git-merge-driver %O %A %B %P']] as const) {
      execFileSync('git', ['-C', root, 'config', '--local', `merge.foundation.${key}`, value])
    }
    io.stdout('Foundation Git merge driver configured')
    return 0
  } catch (error) { io.stderr(String(error)); return 1 }
}
