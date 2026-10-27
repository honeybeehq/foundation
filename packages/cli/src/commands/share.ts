import { shareStateDir } from '../share/share-path.js'
import { sessionFor, saveSession } from '../share/vault.js'
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { ready, recoveryKeypair } from '../share/crypto.js'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { parseArgs, flagString } from '../argv.js'
import type { CliIO } from '../io.js'
import { serviceUrl, readShareConfig, findShareRoot, type ShareConfig } from '../share/config.js'
import {
  api,
  ghToken,
  login,
  initializeKeys,
  maintainKeys,
  sharingStatus,
  prepareDevice,
  createSpace,
  rotateRecovery,
  restoreRecovery
} from '../share/client.js'
function rootAt(flags: Record<string, unknown>): string {
  return resolve(
    typeof flags['repo-root'] === 'string' ? flags['repo-root'] : (findShareRoot(process.cwd()) ?? process.cwd())
  )
}
async function tokenFor(service: string, flags: Record<string, unknown>, io: CliIO): Promise<string> {
  if (flags['token-stdin']) return readFileSync(0, 'utf8').trim()
  if (!flags.oauth) {
    try {
      return ghToken()
    } catch {}
  }
  const { clientId } = await api<{ clientId: string }>({ service }, 'oauth')
  if (!clientId) throw new Error('service needs an OAuth App client id; use gh auth login meanwhile')
  const post = async (path: string, body: Record<string, string>) => {
    const response = await fetch(`https://github.com/${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(10000),
      redirect: 'error'
    })
    if (!response.ok) throw new Error('GitHub device sign-in failed')
    return (await response.json()) as Record<string, string | number>
  }
  const code = await post('login/device/code', { client_id: clientId, scope: 'repo read:user' })
  io.stderr(`Sign in with GitHub: ${code.verification_uri} — code ${code.user_code}`)
  const deadline = Date.now() + Number(code.expires_in) * 1000
  let interval = Math.max(5, Number(code.interval)) * 1000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval))
    const result = await post('login/oauth/access_token', {
      client_id: clientId,
      device_code: String(code.device_code),
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
    if (result.access_token) return String(result.access_token)
    if (result.error === 'slow_down') interval += 5000
    else if (result.error !== 'authorization_pending') throw new Error(`GitHub sign-in: ${result.error}`)
  }
  throw new Error('GitHub sign-in expired')
}
function sshKey(flags: Record<string, unknown>): string {
  if (typeof flags['ssh-key'] === 'string') return flags['ssh-key']
  for (const name of ['id_ed25519', 'id_ecdsa', 'id_rsa']) {
    const path = join(homedir(), '.ssh', name)
    if (existsSync(path)) return path
  }
  throw new Error('select a GitHub SSH signing key with --ssh-key PATH (ssh-agent public-key paths also work)')
}
export async function runShare(args: string[], io: CliIO): Promise<number> {
  if (args[0] === 'github-app') return (await import('./share-github-app.js')).runShareGithubApp(args.slice(1), io)
  const { positionals, flags } = parseArgs(args)
  try {
    if (positionals[0] === 'serve' || positionals[0] === 'backup') {
      const file = flagString(flags, 'config')
      if (!file) throw new Error('share serve/backup requires --config FILE')
      const config = JSON.parse(readFileSync(file, 'utf8'))
      const { startShareService, backupShareService } = await import('../share/service.js')
      if (positionals[0] === 'backup') {
        const dest = positionals[1]
        if (!dest) throw new Error('share backup requires DESTINATION')
        await backupShareService(config, dest)
        io.stdout(`Backup written: ${dest}`)
        return 0
      }
      const service = await startShareService(config)
      io.stderr(`Share service listening: ${service.url}`)
      await new Promise<void>((done) => {
        const stop = () => {
          process.off('SIGTERM', stop)
          process.off('SIGINT', stop)
          void service.close().then(done)
        }
        process.once('SIGTERM', stop)
        process.once('SIGINT', stop)
      })
      return 0
    }
    const root = rootAt(flags)
    if (positionals[0] === 'init') {
      const existing = readShareConfig(root)
      if (!existing) {
        const service = serviceUrl(flagString(flags, 'service') ?? '')
        let repo = flagString(flags, 'repo')
        if (!repo) {
          const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim()
          const match = remote.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/)
          if (!match) throw new Error('pass --repo github.com/OWNER/REPO')
          repo = `github.com/${match[1]}/${match[2]}`
        }
        await ready
        const recovery = recoveryKeypair()
        const config: ShareConfig = { version:1,mode:'self-hosted',service,space:`sp_${randomBytes(16).toString('hex')}`,repo,encryption:'e2e-v1',publicAccess:flags['public-access']==='repo-read'?'repo-read':'collaborators',recoveryPublicKey:recovery.publicKey }
        mkdirSync(join(root,'.foundation'),{recursive:true})
        shareStateDir()
        writeFileSync(join(shareStateDir(),`recovery-${config.space}.txt`),recovery.code+'\n',{mode:0o600,flag:'wx'})
        writeFileSync(join(root,'.foundation/share.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx'})
        io.stdout('Prepared .foundation/share.json locally; no space, token or live data has been created. Commit it to the repository default branch, then rerun foundation share init with the same --repo-root.')
        return 0
      }
      if (flagString(flags,'service') && serviceUrl(flagString(flags,'service')!) !== existing.service) throw new Error('service differs from prepared share.json')
      const token = await tokenFor(existing.service, flags, io)
      const result = await api<{space:string;repo:string;challenge:string}>({service:existing.service},`challenge?repo=${encodeURIComponent(existing.repo)}&requestedSpace=${encodeURIComponent(existing.space)}`)
      if (result.space !== existing.space) throw new Error('repo already has another space; use its committed share.json')
      await createSpace(existing,result.challenge,{...(await prepareDevice(existing,token,sshKey(flags))),repoRoot:root})
      const status = await api<{epoch:number}>(existing,`state?space=${existing.space}`,sessionFor(existing.space).token)
      if (status.epoch === 0) {
        const recoveryFile=join(shareStateDir(),`recovery-${existing.space}.txt`)
        await initializeKeys(existing,readFileSync(recoveryFile,'utf8').trim())
        io.stdout(`Live sharing enabled for ${existing.repo}. Recovery code saved privately to ${recoveryFile}; move it offline.`)
      } else io.stdout(`Live sharing already enabled for ${existing.repo}.`)
      return 0
    }
    const config = readShareConfig(root)
    if (!config) {
      io.stdout(flags.json ? JSON.stringify({ state: 'git-only' }) : 'Live sharing: git-only')
      return 0
    }
    switch (positionals[0]) {
      case 'recovery': {
        if (positionals[1] === 'restore') {
          const file = flagString(flags, 'code-file')
          if (!file) throw new Error('recovery restore requires --code-file FILE')
          await restoreRecovery(config, readFileSync(file, 'utf8').trim())
          io.stdout('Recovery key restored to this device')
          return 0
        }
        if (positionals[1] !== 'rotate') throw new Error('usage: share recovery rotate')
        const code = await rotateRecovery(config),
          path = join(shareStateDir(), `recovery-${config.space}-${Date.now()}.txt`)
        writeFileSync(path, code + '\n', { mode: 0o600, flag: 'wx' })
        writeFileSync(join(root, '.foundation/share.json'), JSON.stringify(config, null, 2) + '\n')
        io.stdout(`Recovery key rotated. Commit share.json and have teammates pull it. Move ${path} offline.`)
        return 0
      }
      case 'login':
        await login(config, await tokenFor(config.service, flags, io), sshKey(flags), !!flags.reattest)
        saveSession(config.space, { ...sessionFor(config.space), repoRoot: root })
        break
      case 'grant':
        await maintainKeys(config)
        break
      case 'revoke-device':
        if (!positionals[1]) throw new Error('revoke-device requires DEVICE_ID')
        await maintainKeys(config, [positionals[1]])
        break
      case 'status':
        break
      default:
        throw new Error(
          'usage: foundation share init --service URL | login [--oauth | --token-stdin] [--ssh-key PATH] [--reattest] | status | grant | revoke-device ID | serve --config FILE | backup DEST --config FILE'
        )
    }
    const status = await sharingStatus(config)
    io.stdout(
      flags.json ? JSON.stringify(status) : `Live sharing: ${status.state}${status.reason ? ` — ${status.reason}` : ''}`
    )
    return status.state === 'no access' ? 1 : 0
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error))
    return 1
  }
}
