import { createInterface } from 'node:readline'
import { format } from 'node:util'
import type { CliIO } from '../io.js'
import { flagString, parseArgs } from '../argv.js'
import { createSession } from '../session/session.js'

const USAGE = 'usage: foundation session <file.fdn.html> [--create] [--title T] [--author A]'

export async function runSession(args: string[], io: CliIO): Promise<number> {
  const { positionals, flags } = parseArgs(args)
  const file = positionals[0]
  if (!file) {
    io.stderr(USAGE)
    return 2
  }

  for (const method of ['log', 'info', 'warn', 'debug'] as const) {
    console[method] = (...values: unknown[]) => io.stderr(format(...values))
  }

  const session = createSession({
    path: file,
    create: flags.create === true,
    title: flagString(flags, 'title'),
    author: flagString(flags, 'author'),
    send: (message) => process.stdout.write(`${JSON.stringify(message)}\n`),
    log: io.stderr,
  })

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  lines.on('line', (line) => session.receive(line))
  lines.on('close', () => session.close())
  const stop = (): void => session.close()
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)

  const code = await session.done
  lines.close()
  process.stdin.pause()
  process.off('SIGTERM', stop)
  process.off('SIGINT', stop)
  await new Promise<void>((resolveFlush) => process.stdout.write('', () => resolveFlush()))
  return code
}
