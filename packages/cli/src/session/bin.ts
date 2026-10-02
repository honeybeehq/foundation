import { processIo } from '../io.js'
import { runSession } from '../commands/session.js'

export function main(args: string[]): Promise<number> {
  return runSession(args, processIo)
}
