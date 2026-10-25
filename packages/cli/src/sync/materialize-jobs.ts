import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync, openSync, closeSync, fsyncSync, linkSync, unlinkSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { modelRoot, persistModel } from './local-model.js'
import { materialize, MaterializeError, type MaterializeRequest } from './materialize.js'
import type { CombConfig } from './daemon.js'
import { readShareConfig } from '../share/config.js'

interface Job { version: 1; requestKey: string; request: MaterializeRequest; configFile?: string }
type Result = { version: 1; requestKey: string } & ({ state: 'pending' } | { state: 'refused'; code: string; message: string; path?: string } | Awaited<ReturnType<typeof materialize>>)
const keyHash = (key: string): string => createHash('sha256').update(key).digest('hex')
const requestDir = (): string => join(modelRoot(), 'materialize', 'requests')
const resultPath = (key: string): string => join(modelRoot(), 'materialize', 'results', `${keyHash(key)}.json`)
function validateKey(key: string): void { if (typeof key !== 'string' || !key || key.length > 256 || /[\u0000-\u001f]/.test(key)) throw new Error('materialize requires a bounded request key') }
/** Local file IPC: accepting a request never reads a vault or waits for network/history. */
export function acceptMaterialize(request: MaterializeRequest, configFile?: string) {
  const requestKey = request.requestKey ?? ''
  validateKey(requestKey)
  const job: Job = { version: 1, requestKey, request, ...(configFile ? { configFile } : {}) }
  const path = join(requestDir(), `${keyHash(requestKey)}.json`)
  mkdirSync(requestDir(), { recursive: true, mode: 0o700 })
  const temp=`${path}.${process.pid}.${randomUUID()}.tmp`
  const descriptor=openSync(temp,'wx',0o600)
  try { writeFileSync(descriptor,JSON.stringify(job));fsyncSync(descriptor) } finally {closeSync(descriptor)}
  try { linkSync(temp,path) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if (readFileSync(path, 'utf8') !== JSON.stringify(job)) throw new Error('request key already identifies a different materialization')
  } finally { unlinkSync(temp) }
  const directory=openSync(requestDir(),'r');try{fsyncSync(directory)}finally{closeSync(directory)}
  return { version: 1 as const, state: 'accepted' as const, requestKey }
}
export function materializeStatus(requestKey: string): Result {
  validateKey(requestKey)
  try {
    const result = JSON.parse(readFileSync(resultPath(requestKey), 'utf8')) as Result
    if (result.version !== 1 || result.requestKey !== requestKey || !['pending', 'ready', 'refused'].includes(result.state)) throw new Error('invalid materialize result')
    return result
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const job = JSON.parse(readFileSync(join(requestDir(), `${keyHash(requestKey)}.json`), 'utf8')) as Job
    if (job.requestKey !== requestKey) throw new Error('invalid materialize request')
    return { version: 1, state: 'pending', requestKey }
  }
}
export function materializeConfig(root: string, configFile?: string): CombConfig {
  try { if (!statSync(realpathSync(root)).isDirectory()) throw new Error('not a checkout') }
  catch { throw new MaterializeError('product-unavailable', 'Product checkout root does not exist; materialize never clones a repository') }
  if (configFile) {
    const config = JSON.parse(readFileSync(configFile, 'utf8')) as CombConfig
    if (!config || typeof config.binary !== 'string' || !Array.isArray(config.args) || config.args.some(a => typeof a !== 'string')) throw new Error('invalid Comb process config')
    return config
  }
  const share = readShareConfig(root)
  if (!share) throw new MaterializeError('unavailable', 'repository has no live sharing configuration')
  return { binary: '', args: [], share }
}
/** One daemon owns this journal. Each explicit request settles once, including typed refusals. */
export async function processMaterializeJobs(signal: AbortSignal, log: (message: string) => void): Promise<void> {
  const reported=new Set<string>()
  while (!signal.aborted) {
    try {
      let files: string[] = []
      try { files = readdirSync(requestDir()).filter(f => /^[a-f0-9]{64}\.json$/.test(f)) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      for (const file of files) {
        if (signal.aborted) break
        try {
        const job = JSON.parse(readFileSync(join(requestDir(), file), 'utf8')) as Job
        if (job.version !== 1 || typeof job.requestKey !== 'string' || !job.request || file !== `${keyHash(job.requestKey)}.json`) throw new Error('invalid queued materialize request')
        if (materializeStatus(job.requestKey).state !== 'pending') continue
        let result: Result
        try {
          const ready = await materialize(job.request, materializeConfig(job.request.checkoutRoot, job.configFile))
          result = { ...ready, version: 1, requestKey: job.requestKey }
        } catch (error) {
          result = { version: 1, requestKey: job.requestKey, state: 'refused', code: error instanceof MaterializeError ? error.code : 'unavailable', message: error instanceof Error ? error.message : String(error), ...(error instanceof MaterializeError && error.path ? { path: error.path } : {}) }
        }
        persistModel(resultPath(job.requestKey), result)
        } catch { if(!reported.has(file)){log(`materialize request ${file}: invalid local request/result; retry with a new key`);reported.add(file);if(reported.size>1000)reported.delete(reported.values().next().value!)} }
      }
    } catch (error) { log(`materialize jobs: ${String(error)}`) }
    if (!signal.aborted) await new Promise<void>(done => {
      const finish = (): void => { clearTimeout(timer); signal.removeEventListener('abort', finish); done() }
      const timer = setTimeout(finish, 100); signal.addEventListener('abort', finish, { once: true })
    })
  }
}
