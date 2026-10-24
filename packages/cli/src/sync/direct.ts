import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { replicaRoot } from '../sync-store.js'
import { createServer, type Server } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { syncTraceSpan } from '../sync-trace.js'

export interface DirectConfig {
  listen: { host: string; port: number }
  workspaces: Record<string, { secret: string; peers: { nodeId: string; url: string }[] }>
}
export interface DirectChange { workspace: string; product: string; docId: string; blobs: string[] }
const LIMIT = 1048576
const signature = (secret: string, body: string): string => createHmac('sha256', secret).update('POST\n/changes\n').update(body).digest('hex')
/** Optional authenticated acceleration. No receipt here is a durable sharing receipt. */
export class DirectChanges {
  private server: Server
  private requests = new Set<AbortController>()
  constructor(private config: DirectConfig, private nodeId: string, receive: (change: DirectChange) => void) {
    if (['0.0.0.0', '::', ''].includes(config.listen.host)) throw new Error('direct sync must bind an explicit interface')
    if (!nodeId) throw new Error('direct sync requires config.node.id')
    for (const workspace of Object.values(config.workspaces)) {
      if (workspace.secret.length < 32) throw new Error('direct sync workspace secret must have at least 32 characters')
      for (const peer of workspace.peers) { if (peer.nodeId === nodeId) throw new Error('direct sync peer cannot be this node'); const url = new URL(peer.url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid direct peer URL'); const octets = url.hostname.split('.').map(Number); const tailnet = octets.length === 4 && octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255); if (url.protocol === 'http:' && !tailnet && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.hostname.startsWith('[fd7a:115c:a1e0:')) throw new Error('HTTP direct peer must use a tailnet or loopback address') }
    }
    this.server = createServer((req, res) => {
      const reject = (code: number): void => { res.writeHead(code); res.end() }
      if (req.method !== 'POST' || req.url !== '/changes') return reject(404)
      const chunks: Buffer[] = []; let size = 0
      req.setTimeout(2000, () => req.destroy())
      req.on('data', (chunk: Buffer) => { size += chunk.length; if (size > LIMIT) req.destroy(); else chunks.push(chunk) })
      req.on('error', () => {})
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8')
          const message = JSON.parse(body) as DirectChange & { nodeId: string; at: number }
          const workspace = Object.hasOwn(this.config.workspaces, message.workspace) ? this.config.workspaces[message.workspace] : undefined
          if (!workspace || !workspace.peers.some(peer => peer.nodeId === message.nodeId) || !Number.isFinite(message.at) || Math.abs(Date.now() - message.at) > 60000) return reject(403)
          const supplied = req.headers['x-foundation-signature']
          const expected = signature(workspace.secret, body)
          if (typeof supplied !== 'string' || !/^[0-9a-f]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'))) return reject(403)
          if (typeof message.product !== 'string' || typeof message.docId !== 'string' || !Array.isArray(message.blobs) || message.blobs.length > 16 || !message.blobs.every(blob => typeof blob === 'string' && /^(?:[a-f0-9]{2})+$/.test(blob))) return reject(400)
          const done = syncTraceSpan('direct.receive', () => ({ docId: message.docId }))
          try { receive(message); done({ ok: true }); reject(204) } catch { done({ ok: false }); reject(409) }
        } catch { reject(400) }
      })
    })
    this.server.on('error', error => { writeDirectStatus('disabled', error.message); this.server.close(); this.server.closeAllConnections() })
    this.server.headersTimeout = 2000
    this.server.requestTimeout = 2000
    this.server.maxConnections = 32
  }
  async start(): Promise<number> { return await new Promise<number>((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.config.listen.port, this.config.listen.host, () => { this.server.removeListener('error', reject); resolve((this.server.address() as { port: number }).port) }) }) }
  push(change: DirectChange): void {
    const workspace = Object.hasOwn(this.config.workspaces, change.workspace) ? this.config.workspaces[change.workspace] : undefined
    if (!workspace) return
    const body = JSON.stringify({ ...change, nodeId: this.nodeId, at: Date.now() })
    if (Buffer.byteLength(body) > LIMIT) return
    for (const peer of workspace.peers) {
      // Bounds process resources even if every peer is unreachable.
      if (this.requests.size >= 32) break
      const controller = new AbortController(); this.requests.add(controller)
      const done = syncTraceSpan('direct.send', () => ({ docId: change.docId, peer: peer.nodeId }))
      const timer = setTimeout(() => controller.abort(), 2000)
      void fetch(new URL('/changes', peer.url), { method: 'POST', redirect: 'error', body, headers: { 'content-type': 'application/json', 'x-foundation-signature': signature(workspace.secret, body) }, signal: controller.signal }).then(res => { void res.body?.cancel().catch(() => {}); done({ ok: res.ok }) }, () => done({ ok: false })).finally(() => { clearTimeout(timer); this.requests.delete(controller) })
    }
  }
  async close(): Promise<void> { for (const request of this.requests) request.abort(); await new Promise<void>(resolve => { this.server.close(() => resolve()); this.server.closeAllConnections() }) }
}

export function writeDirectStatus(state: 'enabled' | 'disabled', reason: string | null): void {
  try { const file = join(replicaRoot(), 'direct-status.json'), temp = `${file}.${process.pid}.tmp`; writeFileSync(temp, JSON.stringify({ state, reason, pid: process.pid }), { mode: 0o600 }); renameSync(temp, file) } catch { /* diagnostics never block durable sync */ }
}
export function readDirectStatus(): { state: string; reason: string | null } {
  try { const value = JSON.parse(readFileSync(join(replicaRoot(), 'direct-status.json'), 'utf8')); process.kill(value.pid, 0); return { state: value.state, reason: value.reason } } catch { return { state: 'disabled', reason: 'daemon unavailable' } }
}
