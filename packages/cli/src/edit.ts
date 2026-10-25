import { createSession } from './session/session.js'
import type { FdnDocument } from 'foundation-engine'
import type { WireServiceMessage, SessionOp } from 'foundation-protocol'

export async function editDocument(
  path: string,
  ops: SessionOp[],
  label: string,
  author: string
): Promise<{ rev: number; doc: FdnDocument }> {
  const messages: WireServiceMessage[] = []
  type Welcome = Extract<WireServiceMessage, { t: 'welcome' }>
  let opened!: (message: Welcome) => void, failed!: (error: Error) => void
  const ready = new Promise<Welcome>((resolve, reject) => {
    opened = resolve
    failed = reject
  })
  const session = createSession({
    path,
    watch: false,
    send: (message) => {
      messages.push(message)
      if (message.t === 'welcome') opened(message)
      else if (message.t === 'fault') failed(new Error(message.message))
    }
  })
  try {
    session.receive(JSON.stringify({ t: 'hello', protocol: '0.2', client: 'foundation-edit', author }))
    const welcome = await ready
    messages.length = 0
    session.receive(JSON.stringify({ t: 'commit', id: 'edit', base: welcome.rev, ops, label }))
    const result = messages.find((message) => message.t === 'result')
    if (!result || result.t !== 'result' || !result.ok)
      throw new Error(
        result?.t === 'result' && !result.ok
          ? result.message
          : messages
              .filter((message) => message.t === 'fault')
              .map((message) => message.message)
              .join('; ') || 'edit failed'
      )
    const view = messages.find((message) => message.t === 'doc')
    return { rev: result.rev, doc: view?.t === 'doc' ? view.doc : welcome.doc }
  } finally {
    session.close()
  }
}
