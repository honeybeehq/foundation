import { syncTrace, syncTraceSpan } from '../sync-trace.js'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

export type Frame = Record<string, unknown>
const MAX_FRAME = 1048576
/** Comb owns the durable format; this client only frames and correlates JSONL RPC. */
export class CombBridge {
  private child: ChildProcessWithoutNullStreams
  private pending = new Map<string, { resolve: (frame: Frame) => void; reject: (err: Error) => void; timer: NodeJS.Timeout; op: string; finish: ReturnType<typeof syncTraceSpan> }>()
  private sequence = 0
  private buffer = Buffer.alloc(0)
  private closed = false
  private diagnostics = ''
  constructor(binary: string, args: string[]) {
    this.child = spawn(binary, args, { stdio: 'pipe' })
    syncTrace('bridge.spawn', () => ({ bridgePid: this.child.pid }))
    this.child.stderr.on('data', chunk => { this.diagnostics = (this.diagnostics + String(chunk)).slice(-4096) })
    this.child.on('error', err => this.fail(err))
    this.child.on('exit', (code, signal) => this.fail(new Error(`Comb bridge exited (${code ?? signal})${this.diagnostics ? `: ${this.diagnostics.trim()}` : ''}`)))
    this.child.stdin.on('error', err => this.fail(err))
    this.child.stdout.on('data', (chunk: Buffer) => {
      try {
        this.buffer = Buffer.concat([this.buffer, chunk])
        let newline: number
        while ((newline = this.buffer.indexOf(10)) !== -1) {
          if (newline > MAX_FRAME) throw new Error('Comb response exceeds frame limit')
          const frame = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(this.buffer.subarray(0, newline))) as Frame
          this.buffer = this.buffer.subarray(newline + 1)
          if (frame.v !== 1 || typeof frame.id !== 'string' || typeof frame.ok !== 'boolean') throw new Error('invalid Comb response')
          const entry = this.pending.get(frame.id)
          if (!entry) throw new Error('unknown Comb response id')
          if (frame.ok && frame.op !== entry.op) throw new Error('Comb response operation mismatch')
          clearTimeout(entry.timer); this.pending.delete(frame.id); entry.finish({ ok: frame.ok })
          if (frame.ok) entry.resolve(frame); else entry.reject(new Error(`Comb: ${JSON.stringify(frame.error)}`))
        }
        if (this.buffer.length > MAX_FRAME) throw new Error('Comb response exceeds frame limit')
      } catch (err) { this.fail(err instanceof Error ? err : new Error(String(err))) }
    })
  }
  private fail(err: Error): void {
    this.closed = true
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.finish({ ok: false }); entry.reject(err) }
    this.pending.clear(); this.child.kill()
  }
  close(): void { this.fail(new Error('Comb bridge closed')) }
  /** EOF lets Comb release its writer lease; killing a writer strands it until TTL. */
  async finish(): Promise<void> {
    if (this.closed) return
    const released = syncTraceSpan('bridge.release', () => ({ bridgePid: this.child.pid }))
    try { await new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.child.kill(); resolve() }, 5000)
      this.child.once('exit', () => { clearTimeout(timer); resolve() })
      this.child.stdin.end()
    }) } finally { released() }
  }
  request(op: string, fields: Frame = {}): Promise<Frame> {
    if (this.closed) return Promise.reject(new Error('Comb bridge is closed'))
    const id = String(++this.sequence)
    const line = `${JSON.stringify({ v: 1, id, op, ...fields })}\n`
    if (Buffer.byteLength(line) > MAX_FRAME) return Promise.reject(new Error('change exceeds Comb frame limit'))
    const finish = syncTraceSpan(`rpc.${op}`, () => ({ bridgePid: this.child.pid, rpcId: id, log: fields.log, cursor: fields.cursor, hash: fields.idempotency_key }))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`Comb ${op} timed out`)), 35000)
      this.pending.set(id, { resolve, reject, timer, op, finish })
      this.child.stdin.write(line)
    })
  }
  async hello(): Promise<void> {
    const frame = await this.request('hello', { require: ['durable_idempotency', 'bounded_memory_read'] })
    const caps = frame.capabilities as Frame | undefined
    if (frame.protocol !== 1 || caps?.durable_idempotency !== true || caps.bounded_memory_read !== true) throw new Error('Comb bridge lacks required capabilities')
  }
}

export function validateAppendReceipt(receipt: Frame, log: string): void {
  if (receipt.log !== log || typeof receipt.first !== 'string' || !/^[1-9][0-9]*$/.test(receipt.first) || receipt.last !== receipt.first || receipt.cursor !== String(BigInt(receipt.first) + 1n)) throw new Error('invalid Comb append receipt')
}
