import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { HostClient, loopbackURL } from '../src/host-client.js'
import { parseState, statusText, type HostState } from '../src/contract.js'
import { seedDocument } from '../src/model.js'

const seed = seedDocument({ tokens: {}, nodes: [] }, 'assets/cover.jpeg')
const state: HostState = { document: seed, connection: 'disconnected', status: { replicaId: 'replica-a', docId: 'doc-a', log: 'log-a', cursor: '0', scanCursor: '0', locallySaved: 1, pending: 1, published: 0, staged: 0, stagedBytes: 0, causalGap: false, sync: { kind: 'offline' } } }
const servers: Server[] = []
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } })
async function server(handler: (url: string, body: unknown, token: string | undefined) => { status?: number; body: unknown }) {
  const instance = createServer(async (request, response) => {
    let text = ''; for await (const data of request) text += String(data)
    const result = handler(request.url!, text ? JSON.parse(text) : undefined, request.headers.authorization)
    response.writeHead(result.status ?? 200, { 'content-type': 'application/json' }); response.end(JSON.stringify(result.body))
  })
  servers.push(instance)
  await new Promise<void>(resolve => instance.listen(0, '127.0.0.1', resolve))
  const address = instance.address(); if (!address || typeof address === 'string') throw new Error('No test listener')
  return new HostClient({ url: `http://127.0.0.1:${address.port}`, token: 'test-only', directory: '/test/replica-a', docId: 'doc-a', author: 'user:test', seed })
}

describe('main-process HTTP boundary', () => {
  it('opens only once and sends granular commits with main-owned author and token', async () => {
    const requests: { url: string; body: unknown }[] = []
    const client = await server((url, body, token) => {
      expect(token).toBe('Bearer test-only'); requests.push({ url, body })
      return { body: url.endsWith('/open') ? { sessionId: 'a/b', state } : { receipt: { status: 'locally_saved', hash: 'hash-a' }, state } }
    })
    await Promise.all([client.open(), client.open()])
    await client.commit([{ op: 'set-text', id: 'heading', text: 'Offline edit' }], 'Edit headline')
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual({ url: '/v1/replicas/a%2Fb/commit', body: { meta: { author: 'user:test', message: 'Edit headline' }, ops: [{ op: 'set-text', id: 'heading', text: 'Offline edit' }] } })
    await expect(client.commit([{ op: 'replace-document', doc: seed }], 'Overwrite')).rejects.toThrow('granular')
  })
  it('does not invent a local receipt on server failure or malformed success', async () => {
    const client = await server(url => ({ status: url.endsWith('/open') ? 200 : 409, body: url.endsWith('/open') ? { sessionId: 'a', state } : { error: { code: 'lease_held', message: 'Publisher lease held elsewhere' } } }))
    await client.open()
    await expect(client.commit([{ op: 'set-text', id: 'heading', text: 'x' }], 'Edit')).rejects.toThrow('lease_held')
    const malformed = await server(url => ({ body: url.endsWith('/open') ? { sessionId: 'b', state } : { state } }))
    await malformed.open()
    await expect(malformed.annotate({ text: 'Comment' })).rejects.toThrow('did not confirm')
  })
  it('validates state and limits host addresses to plain loopback origins', () => {
    for (const url of ['https://example.com', 'http://127.0.0.1:42/?token=secret', 'http://user:pass@localhost:42', 'http://localhost:42/path']) expect(() => loopbackURL(url)).toThrow()
    expect(loopbackURL('http://127.0.0.1:1234')).toBe('http://127.0.0.1:1234')
    expect(() => parseState({ ...state, status: { ...state.status, pending: -1 } })).toThrow()
    expect(() => parseState({ ...state, document: {} })).toThrow()
  })
  it('reopens an expired service session without replaying any mutation', async () => {
    let opens = 0
    const client = await server(url => url.endsWith('/open') ? { body: { sessionId: `session-${++opens}`, state } } : { status: 404, body: { error: { code: 'not_found', message: 'Session expired after host restart' } } })
    await client.open(); await client.open()
    expect(opens).toBe(2)
  })
  it('distinguishes offline, paused, causal gaps and published state', () => {
    expect(statusText(state)).toBe('Saved locally · 1 pending · Offline')
    expect(statusText({ ...state, connection: 'connected' })).not.toContain('Published')
    expect(statusText({ ...state, connection: 'connected', status: { ...state.status, sync: { kind: 'paused', reason: 'lease_held' } } })).toContain('Paused: lease_held')
    expect(statusText({ ...state, connection: 'connected', status: { ...state.status, pending: 0, sync: { kind: 'caught_up' } } })).toBe('Published · Up to date')
    expect(statusText({ ...state, connection: 'connected', status: { ...state.status, pending: 0, causalGap: true, sync: { kind: 'caught_up' } } })).toContain('Waiting for earlier changes')
  })
})
