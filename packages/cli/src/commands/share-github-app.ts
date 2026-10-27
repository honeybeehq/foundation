import { constants } from 'node:fs'
import { mkdir, open, realpath, stat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { flagString, parseArgs } from '../argv.js'
import type { CliIO } from '../io.js'
import { checkContentsRefusal, checkSingleFileRead, defaultGithubAppPath, githubJson, githubRepo, githubRequest, mintMetadataToken, parseGithubAppConfig, readGithubAppConfig } from '../share/github-app.js'

async function outsideRepo(path: string): Promise<string> {
  const absolute = resolve(path)
  let existing = dirname(absolute)
  while (true) {
    try { await stat(existing); break } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      existing = dirname(existing)
    }
  }
  let ancestor = await realpath(existing)
  while (true) {
    try { await stat(join(ancestor, '.git')); throw new Error('Private config must be outside every Git repository') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const parent = dirname(ancestor)
    if (parent === ancestor) break
    ancestor = parent
  }
  return absolute
}

export async function finishGithubApp(code: string, out: string, fetcher: typeof fetch = fetch): Promise<{ path: string; installUrl: string }> {
  if (!/^[a-zA-Z0-9_-]+$/.test(code)) throw new Error('Invalid manifest code')
  const path = await outsideRepo(out)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await outsideRepo(path)
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try {
    const result = await githubJson(await githubRequest(`/app-manifests/${encodeURIComponent(code)}/conversions`, undefined, 'POST', undefined, fetcher))
    const config = parseGithubAppConfig({ appId: result.id, slug: result.slug, clientId: result.client_id, privateKey: result.pem })
    await file.writeFile(`${JSON.stringify(config, null, 2)}\n`)
    await file.sync()
    return { path, installUrl: `https://github.com/apps/${config.slug}/installations/new` }
  } catch (error) {
    await unlink(path).catch(() => {})
    throw error
  } finally { await file.close() }
}

export async function runShareGithubApp(args: string[], io: CliIO): Promise<number> {
  const { positionals, flags } = parseArgs(args)
  const command = positionals[0]
  const usage = 'foundation share github-app finish --code CODE [--out ~/.foundation/share-service/github-app.json]\nfoundation share github-app check --user LOGIN [--config PATH] [--repo honeybeehq/foundation] [--single-file]'
  if (flags.help || !command) { io.stdout(usage); return flags.help ? 0 : 2 }
  try {
    if (command === 'finish') {
      const code = flagString(flags, 'code')
      if (!code) throw new Error('Pass --code from the setup page (valid for one hour)')
      const result = await finishGithubApp(code, flagString(flags, 'out') ?? defaultGithubAppPath)
      io.stdout(`Saved private GitHub App config: ${result.path}\nInstall: ${result.installUrl}\nChoose Only select repositories → honeybeehq/foundation\nThen run: foundation share github-app check --user trmdy`)
      return 0
    }
    if (command === 'check') {
      const user = flagString(flags, 'user')
      if (!user || !/^[a-zA-Z0-9-]+$/.test(user)) throw new Error('Pass --user GitHub-login')
      const repo = githubRepo(flagString(flags, 'repo') ?? 'honeybeehq/foundation')
      const configPath = flagString(flags, 'config') ?? defaultGithubAppPath
      if (!isAbsolute(configPath)) throw new Error('--config must be an absolute private path')
      const config = await readGithubAppConfig(configPath)
      const { token, singleFile } = await mintMetadataToken(repo, config)
      if (flags['single-file'] && !singleFile) throw new Error('Enable Single file: read for .foundation/share.json in App settings, then accept the updated installation permissions')
      const metadata = await githubJson(await githubRequest(`/repos/${repo}/collaborators/${encodeURIComponent(user)}/permission`, token))
      if (typeof metadata.permission !== 'string') throw new Error('GitHub returned no user permission')
      io.stdout(`Metadata allowed: ${user} on ${repo}: ${metadata.permission}`)
      if (singleFile) io.stdout(await checkSingleFileRead(repo, token))
      io.stdout(await checkContentsRefusal(repo, config, token))
      io.stdout(singleFile ? 'App grants verified: Metadata read and Single file read limited to .foundation/share.json; no Contents.' : 'App permissions verified: Metadata read only; no Contents. Installation token minted successfully.')
      return 0
    }
    throw new Error(usage)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GitHub App setup failed'
    io.stderr(message.startsWith('EEXIST:') ? 'Output already exists; choose another private path. Existing credentials were kept.' : message)
    return 1
  }
}
