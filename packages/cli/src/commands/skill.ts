import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { CliIO } from '../io.js'

export const editSkillPath = fileURLToPath(new URL('../../skills/foundation-edit/SKILL.md', import.meta.url))

export async function runSkill(args: string[], io: CliIO): Promise<number> {
  if (args.length === 1 && args[0] === 'path') {
    io.stdout(editSkillPath)
    return 0
  }
  io.stderr('usage: foundation skill path')
  return 2
}

export async function runHelp(args: string[], io: CliIO): Promise<number> {
  if (args.length === 1 && args[0] === 'edit') {
    io.stdout(readFileSync(editSkillPath, 'utf8'))
    return 0
  }
  io.stderr('usage: foundation help edit')
  return 2
}
