import { createSession } from './session/session.js'
import type { FdnDocument } from 'foundation-engine'
import type { WireServiceMessage, SessionOp } from 'foundation-protocol'

export function editDocument(path: string, ops: SessionOp[], label: string, author: string): { rev: number; doc: FdnDocument } {
  const messages: WireServiceMessage[] = []
  const session = createSession({ path, watch: false, send: message => messages.push(message) })
  try {
    session.receive(JSON.stringify({ t: 'hello', protocol: '0.2', client: 'foundation-edit', author }))
    const welcome = messages.find(message => message.t === 'welcome')
    if (!welcome || welcome.t !== 'welcome') throw new Error(messages.filter(message => message.t === 'fault').map(message => message.message).join('; ') || 'could not open document')
    messages.length = 0
    session.receive(JSON.stringify({ t: 'commit', id: 'edit', base: welcome.rev, ops, label }))
    const result = messages.find(message => message.t === 'result')
    if (!result || result.t !== 'result' || !result.ok) throw new Error(result?.t === 'result' && !result.ok ? result.message : messages.filter(message => message.t === 'fault').map(message => message.message).join('; ') || 'edit failed')
    const view = messages.find(message => message.t === 'doc')
    return { rev: result.rev, doc: view?.t === 'doc' ? view.doc : welcome.doc }
  } finally { session.close() }
}
