import { mkdir, open, readFile, rename, rm, copyFile, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface ShareDevice {
  id: string
  service: string
  login: string
  githubId: number
  boxPublicKey: string
  signPublicKey: string
  signature: string
}
export interface ShareWrap { epoch: number; deviceId: string; senderId: string; box: string; signature: string }
export interface ShareSpace {
  space: string
  repo: string
  epoch: number
  recoveryPublicKey?: string
  devices: ShareDevice[]
  wraps: ShareWrap[]
  revoked: string[]
}
interface Metadata { version: 1; spaces: ShareSpace[] }
/** Public registry and sealed boxes only. Never store bearer tokens or design keys here. */
export class ShareServiceStore {
  private data: Metadata = { version: 1, spaces: [] }
  private tail: Promise<unknown> = Promise.resolve()
  private constructor(readonly stateDir: string) {}
  static async open(stateDir: string): Promise<ShareServiceStore> {
    await mkdir(stateDir, { recursive: true, mode: 0o700 })
    if (!(await lstat(stateDir)).isDirectory() || (await lstat(stateDir)).isSymbolicLink()) throw new Error('stateDir must be a real directory')
    const store = new ShareServiceStore(stateDir)
    try {
      const path = join(stateDir, 'metadata.json')
      if (!(await lstat(path)).isFile() || (await lstat(path)).isSymbolicLink()) throw new Error('metadata must be a regular file')
      const data = JSON.parse(await readFile(path, 'utf8')) as Metadata
      if (data.version !== 1 || !Array.isArray(data.spaces)) throw new Error('unsupported share metadata')
      store.data = data
    } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err }
    return store
  }
  spaces(): ShareSpace[] { return structuredClone(this.data.spaces) }
  get(id: string): ShareSpace | undefined { return this.spaces().find(s => s.space === id) }
  /** Serialize metadata transactions and publish in memory only after atomic durable replacement. */
  update<T>(change: (spaces: ShareSpace[]) => T): Promise<T> {
    const operation = this.tail.then(async () => {
      const next = structuredClone(this.data)
      const result = change(next.spaces)
      const temp = join(this.stateDir, `metadata-${randomUUID()}.tmp`)
      const file = await open(temp, 'wx', 0o600)
      try { await file.writeFile(JSON.stringify(next)); await file.sync() } finally { await file.close() }
      await rename(temp, join(this.stateDir, 'metadata.json'))
      const directory = await open(this.stateDir, 'r')
      try { await directory.sync() } finally { await directory.close() }
      this.data = next
      return result
    })
    this.tail = operation.catch(() => {})
    return operation
  }
}

/** Metadata ONLY. Stop the service and snapshot the operator-owned Comb backend separately.
 * Restore metadata.json into stateDir and restore the matching Comb tenant/digest key/backend
 * snapshot before restarting. This function does not back up local or S3 Comb contents.
 */
export async function backupShareMetadata(stateDir: string, destination: string): Promise<void> {
  await mkdir(destination, { mode: 0o700 }) // refuse overwriting a previous backup
  try {
    await copyFile(join(stateDir, 'metadata.json'), join(destination, 'metadata.json'))
    const file = await open(join(destination, 'BACKUP.json'), 'wx', 0o600)
    try { await file.writeFile(JSON.stringify({ version: 1, scope: 'metadata-only', backendIncluded: false, requiresStoppedService: true, restore: 'Restore metadata.json and a matching separately captured Comb backend snapshot, tenant and digest key before starting.' })) } finally { await file.close() }
  } catch (error) { await rm(destination, { recursive: true, force: true }); throw error }
}
