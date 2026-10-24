import { randomUUID } from 'node:crypto'
import { createSession } from './session/session.js'
import type { WireServiceMessage, ClientMessage } from 'foundation-protocol'

export type EditResult = Extract<WireServiceMessage, { t: 'result' }>

export async function editDocument(path: string, ops: unknown[], label: string, author: string, id: string = randomUUID(), guards: Pick<Extract<ClientMessage, { t: 'commit' }>, 'expectedHead' | 'expectedDocId' | 'durable'> = {}): Promise<EditResult> {
  let receive: (message: WireServiceMessage) => void = () => {}
  const session = createSession({ path, watch: false, send: message => receive(message) })
  const next = (send: object): Promise<WireServiceMessage> => new Promise(resolve => {
    receive = message => {
      if (message.t === 'welcome' || message.t === 'result' || message.t === 'fault') resolve(message)
    }
    session.receive(JSON.stringify(send))
  })
  const failed = (message: WireServiceMessage): EditResult => ({ t: 'result', id, ok: false, rev: 0, head: null, nodeIds: [], code: 'write-failed', message: message.t === 'fault' ? message.message : 'could not open document' })
  try {
    const welcome = await next({ t: 'hello', protocol: '0.2', client: 'foundation-edit', artboardFrames: true, author })
    if (welcome.t !== 'welcome') return failed(welcome)
    const result = await next({ t: 'commit', id, base: welcome.rev, ops, label, ...guards })
    return result.t === 'result' ? result : failed(result)
  } finally { session.close() }
}
