#!/usr/bin/env -S npx tsx
/**
 * foundation-cli — entry point (API.md "CLI (packages/cli)"). Zero-dependency
 * argv parsing; bin name `foundation`; tsx is the runtime (this file is the
 * bin target directly — fine for v0 per the task brief).
 *
 * Command dispatch only lives here; every command is a small, independently
 * testable function under ./commands/ that takes (args, io) and returns an
 * exit code — main.ts's only jobs are picking the command and calling
 * process.exit with what it returns.
 */
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { processIo } from './io.js'
import type { CliIO } from './io.js'
import { runCapabilities } from './commands/capabilities.js'

const COMMANDS: Record<string, (args: string[], io: CliIO) => Promise<number>> = {
  doctor: async (args, io) => args.includes('--capabilities') ? runCapabilities(args, io) : (await import('./commands/doctor.js')).runDoctor(args, io),
  install: async (args, io) => (await import('./commands/install.js')).runInstall(args, io),
  version: async (_args, io) => { io.stdout(JSON.stringify((await import('./runtime-version.js')).runtimeVersion())); return 0 },
  share: async (args, io) => (await import('./commands/share.js')).runShare(args, io),
  sync: async (args, io) => (await import('./commands/sync.js')).runSync(args, io),
  new: async (args, io) => (await import('./commands/new.js')).runNew(args, io),
  copy: async (args, io) => (await import('./commands/copy.js')).runCopy(args, io),
  inspect: async (args, io) => (await import('./commands/inspect.js')).runInspect(args, io),
  validate: async (args, io) => (await import('./commands/validate.js')).runValidate(args, io),
  ingest: async (args, io) => (await import('./commands/ingest.js')).runIngest(args, io),
  import: async (args, io) => (await import('./commands/import.js')).runImport(args, io),
  bake: async (args, io) => (await import('./commands/bake.js')).runBake(args, io),
  render: async (args, io) => (await import('./commands/render.js')).runRender(args, io),
  diff: async (args, io) => (await import('./commands/diff.js')).runDiff(args, io),
  serve: async (args, io) => (await import('./commands/serve.js')).runServe(args, io),
  chain: async (args, io) => (await import('./commands/chain.js')).runChain(args, io),
  annotate: async (args, io) => (await import('./commands/annotate.js')).runAnnotate(args, io),
  annotations: async (args, io) => (await import('./commands/annotate.js')).runAnnotations(args, io),
  freeze: async (args, io) => (await import('./commands/freeze.js')).runFreeze(args, io),
  mcp: async (args, io) => (await import('./commands/mcp.js')).runMcp(args, io),
  gateway: async (args, io) => (await import('./commands/gateway.js')).runGateway(args, io),
  git: async (args, io) => (await import('./commands/git.js')).runGit(args, io),
  'git-merge-driver': async (args, io) => (await import('./commands/git-merge-driver.js')).runGitMergeDriver(args, io),
  project: async (args, io) => (await import('./commands/project.js')).runProject(args, io),
  session: async (args, io) => (await import('./commands/session.js')).runSession(args, io),
  edit: async (args, io) => (await import('./commands/edit.js')).runEdit(args, io),
  help: async (args, io) => (await import('./commands/skill.js')).runHelp(args, io),
  skill: async (args, io) => (await import('./commands/skill.js')).runSkill(args, io),
}

const USAGE = `foundation — a design-document engine CLI

usage: foundation <command> [args]

commands:
  version [--json]                          report source revision and compatibility
  install [--from CHECKOUT] [--sha SHA] [--force] [--dry-run]  plan or install a node-level copy
  install --rollback [--dry-run]            restore the previous activation
  doctor --inventory --json                  inventory executable copies without changing them
  doctor --capabilities --json [--product-root ABS] [--design-path ABS] [--foundation-path ABS]
                                              report installed runtime and selected checkout without writes
  share init|login|status|grant|revoke-device|serve|backup     encrypted repo sharing
  share github-app finish|check             register and verify a Metadata-only GitHub App
  sync open|close|serve|status|materialize                    register live designs, sync through Comb, inspect local/upload state
  new <name> [--no-chain]                    write a minimal .fdn.html skeleton (chain-inits it too)
  copy <src> <dest> [--title T] [--json]      create an independent document with a fresh identity and chain
  inspect <file>                             summarize a document
  validate <file>                            print validation issues
  ingest <file> [--commit [-m msg] [--author A]]   normalize in place; tracked files always commit with author
  import <source.tsx> --into <file.fdn.html> [--name N] [--props <json>] [--sealed] [--author A]
                                              harvest a React component and merge it into <file>
                                              (chain-committed when a chain exists)
  edit <file> --ops JSON | --ops-file FILE|-   one atomic semantic edit batch
  help edit                                 print the agent editing quick reference
  skill path                                print its installed absolute path
  bake <file> [--artboard ID] [--state S] [--viewport V] [-o out]           bake a state to HTML
  render <file> [--state S] [--viewport V] [--scale 1..4] [-o dir | --out file.png] [--json]
  diff <a.html> <b.html>                     structural (+ visual, when available) diff
  serve <file> [--port N]                    live-reload dev server
  chain init <file> [--author A] [-m msg]    start a chain for <file> (mints a data-fdn-doc-id)
  chain <file> log|verify                    operate on <file>.chain
  chain recover <file>                      back up unapplied text and restore the current projection
  chain anchor <file> <name>                 name the chain's current head
  chain diff <file> <anchorA> <anchorB>      show SemanticOps between two anchors
  chain push <file> <dir>                    export missing blobs to <dir>/<docId>/
  chain pull <file> <dir>                    import missing blobs from <dir>/<docId>/, then regenerate
                                              <file> from the merged chain — UNLESS <file> has
                                              uncommitted edits (differs from the chain's pre-pull head),
                                              in which case the chain still imports but the text is left
                                              alone and a warning to run 'ingest --commit' first is printed
  chain sync <file> <dir>                    pull (same text-regeneration/uncommitted-edits behavior as
                                              'chain pull', above) then push
  chain merge <file> <theirs.chain>          merge chains, regenerate <file> text, print overlap report
  annotate <file> --text T [--node id | --x N --y N] [--state S]   leave a new annotation
                                              (chain-committed; requires a chain — see chain init)
  annotate <file> --resolve <id>             mark an annotation resolved
  annotate <file> --wontfix <id>             mark an annotation wontfix
  annotations <file>                         list a document's annotations with status
  freeze <file> -o <dest> [--author A] [-m msg]   crystallize a lock-headered frozen file
  freeze --verify <frozenfile>               check a frozen file's lock header + pedigree
  project init [dir] [--name N]              write a fresh foundation.json manifest
  project add <file>                         register <file> in ./foundation.json (by docId)
  project path <docId> [dir]                 resolve a document id from the known manifest
  project list [dir]                         list a manifest's documents + validate/chain status
  project scan [dir]                         discover *.fdn.html under dir not yet registered, add them
  mcp                                        run a stdio MCP server exposing Foundation's verbs
  session <file> [--create] [--title T] [--author A]
                                              long-lived editing session speaking the JSON-lines
                                              session protocol on stdin/stdout (packages/protocol)
  gateway install|uninstall|status           publish/withdraw the operator-gateway registry entry
  git setup                                 configure chain-aware Git merges
  git pull [remote [branch]]                fast-forward while preserving live-synced design edits
  git prepare-update <incoming> -- <command> [args...]
                                              hold design locks around another fast-forward update
  git recover-update <backup-directory>      restore edits after an interrupted update
  git-merge-driver <ancestor> <ours> <theirs> [repo-path]   git merge driver (see docs/GIT-INTEGRATION.md)
`

export async function runCli(argv: string[], io: CliIO = processIo): Promise<number> {
  if (argv[0] === '--version') { io.stdout(JSON.stringify((await import('./runtime-version.js')).runtimeVersion())); return 0 }
  const [command, ...rest] = argv
  if (!command || command === '--help' || command === '-h') {
    io.stdout(USAGE)
    return command ? 0 : 2
  }
  const handler = COMMANDS[command]
  if (!handler) {
    io.stderr(`unknown command "${command}"`)
    io.stdout(USAGE)
    return 2
  }
  const code = await handler(rest, io)
  // Commands with a document first argument include CLI and MCP-independent edits.
  const editedFile = command === 'copy' ? rest[1] : ['new', 'edit', 'annotate', 'ingest'].includes(command) ? rest[0] : undefined
  if (code === 0 && editedFile?.endsWith('.fdn.html')) (await import('./sync-store.js')).autoOpenDesign(editedFile, io.stderr)
  return code
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return false
  }
}

if (isMainModule()) {
  runCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      processIo.stderr(`internal error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
      process.exit(1)
    },
  )
}
