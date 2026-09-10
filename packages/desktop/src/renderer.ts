import { editsBetween, fromDocument, type DesignModel } from './model.js'
import { statusText, type DesktopAPI, type HostState } from './contract.js'
import type { PatchOp } from '../../engine/src/types.js'

interface Editor {
  model(): DesignModel
  selection(): string | undefined
  interacting(): boolean
  replace(model: DesignModel): void
  select(id: string): void
}
declare global {
  interface Window {
    foundationHost: DesktopAPI
    foundationEditor: Editor
    foundationSession: { canEdit(): boolean; edit(before: DesignModel, after: DesignModel): void; undo(): void; redo(): void }
  }
}
const api = window.foundationHost
const editor = window.foundationEditor
function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`Missing desktop control ${selector}`)
  return found
}
const inspector = element('.inspector')
const pane = document.createElement('section')
pane.id = 'collaboration-pane'; pane.className = 'hidden'
pane.innerHTML = `<h3 class="section-title">Comments & sync</h3>
  <div class="sync-controls"><button id="connect-host">Connect</button><button id="disconnect-host">Disconnect</button><button id="sync-host">Sync now</button></div>
  <div id="sync-detail"></div><div id="host-error" role="alert"></div><button id="reload-saved" class="hidden">Reload saved state</button>
  <h3 class="section-title">Comments</h3><div id="comment-list"></div>
  <label id="comment-anchor" for="comment-text">Comment on selection</label><textarea id="comment-text" placeholder="Leave a note on this layer…"></textarea><button id="post-comment">Post comment</button>`
inspector.append(pane)
let state: HostState | undefined
let ready = false, failed = false, unconfirmed = false, pending = 0, polling = false, remoteChanged = false
let revision = 0
let chain: Promise<void> = Promise.resolve()
type UndoEntry = { forward: PatchOp[]; inverse: PatchOp[] }
const past: UndoEntry[] = [], future: UndoEntry[] = []
let commentsOpen = false

function showComments(open = true) {
  commentsOpen = open
  inspector.classList.toggle('comments-open', open)
  pane.classList.toggle('hidden', !open)
  if (open) inspector.classList.add('mobile-open')
  updateControls()
}
function updateControls() {
  element<HTMLButtonElement>('#undo').disabled = !ready || failed || pending > 0 || past.length === 0
  element<HTMLButtonElement>('#redo').disabled = !ready || failed || pending > 0 || future.length === 0
  element<HTMLButtonElement>('#post-comment').disabled = !ready || failed || pending > 0 || !element<HTMLTextAreaElement>('#comment-text').value.trim()
  element<HTMLButtonElement>('#disconnect-host').disabled = !state || pending > 0 || state.connection === 'disconnected'
  element<HTMLButtonElement>('#connect-host').disabled = !state || pending > 0
  element('#connect-host').textContent = state?.connection === 'connected' || state?.connection === 'error' ? 'Reconnect' : 'Connect'
  element<HTMLButtonElement>('#sync-host').disabled = !state || pending > 0 || state.connection !== 'connected'
  const selection = editor.selection()
  element('#comment-anchor').textContent = selection ? `Comment on ${editor.model().nodes.find(n => n.id === selection)?.name ?? selection}` : 'Comment on document'
  if (!failed) element('#save-status').textContent = pending ? `Saving locally · ${pending} edit${pending === 1 ? '' : 's'}` : state ? statusText(state) : 'Opening local replica…'
  if (state) {
    const s = state.status
    element('#sync-detail').textContent = `${statusText(state)}\n${s.published} published · ${s.pending} pending\nReplica ${s.replicaId}\nDocument ${s.docId}`
    element('.file-location').textContent = `Local replica · ${s.replicaId.slice(0, 8)}`
  }
}
function renderComments() {
  const list = element('#comment-list'); list.replaceChildren()
  for (const annotation of state?.document?.annotations ?? []) {
    const card = document.createElement('article'); card.className = 'comment-card'
    const label = document.createElement('small'); label.textContent = `${annotation.nodeId ?? 'Document'} · ${annotation.status}`
    const text = document.createElement('p'); text.textContent = annotation.text
    const resolve = document.createElement('button'); resolve.textContent = annotation.status === 'open' ? 'Resolve' : 'Reopen'
    resolve.disabled = !ready || failed || pending > 0
    resolve.onclick = () => enqueue(async () => (await api.commit([{ op: 'set-annotation-status', id: annotation.id, status: annotation.status === 'open' ? 'resolved' : 'open' }], 'Change comment status')).state)
    card.append(label, text, resolve)
    if (annotation.nodeId) {
      const target = annotation.nodeId
      const jump = document.createElement('button'); jump.textContent = 'Show layer'; jump.onclick = () => { editor.select(target); showComments(false) }
      card.append(jump)
    }
    list.append(card)
  }
  if (!list.childElementCount) list.textContent = 'No comments yet.'
}
function applyState(next: HostState, force = false) {
  const changed = JSON.stringify(next.document) !== JSON.stringify(state?.document)
  state = next; ready = next.document !== null
  document.body.classList.toggle('host-loading', !ready)
  remoteChanged ||= changed
  if (next.document && pending === 0 && !failed && (force || !editor.interacting()) && remoteChanged) {
    editor.replace(fromDocument(next.document)); remoteChanged = false
  }
  renderComments(); updateControls()
}
function failure(error: unknown, uncertain = false) {
  failed = true
  unconfirmed ||= uncertain
  const message = error instanceof Error ? error.message : String(error)
  element('#host-error').textContent = unconfirmed ? `Save not confirmed. ${message}\nYour current draft remains visible. Reload saved state to check what the host retained.` : `Local host unavailable. ${message}\nReload saved state to reconnect to the local host.`
  element('#save-status').textContent = unconfirmed ? 'Save not confirmed · Review sync' : 'Local host unavailable'
  element('#reload-saved').classList.remove('hidden')
  showComments(); updateControls()
}
function enqueue(action: () => Promise<HostState>, onSuccess?: () => void, mutation = true) {
  if (!state || failed) return
  revision++; pending++; updateControls()
  chain = chain.then(async () => {
    if (failed) return
    try { const next = await action(); state = next; remoteChanged = true; onSuccess?.() }
    catch (error) { failure(error, mutation) }
  }).finally(() => {
    pending--; if (state && !failed) applyState(state); else updateControls()
  })
}
window.foundationSession = {
  canEdit: () => ready && !failed,
  edit(before, after) {
    const forward = editsBetween(before, after)
    if (!forward.length) return
    const entry = { forward, inverse: editsBetween(after, before) }
    enqueue(async () => (await api.commit(forward, 'Edit canvas')).state, () => { past.push(entry); if (past.length > 80) past.shift(); future.length = 0 })
  },
  undo() {
    if (pending || failed || !past.length) return
    const entry = past[past.length - 1]!
    enqueue(async () => (await api.commit(entry.inverse, 'Undo canvas edit')).state, () => { past.pop(); future.push(entry) })
  },
  redo() {
    if (pending || failed || !future.length) return
    const entry = future[future.length - 1]!
    enqueue(async () => (await api.commit(entry.forward, 'Redo canvas edit')).state, () => { future.pop(); past.push(entry) })
  },
}
document.body.classList.add('host-loading')
element<HTMLButtonElement>('[data-future="comments"]').onclick = () => showComments(!commentsOpen)
element<HTMLButtonElement>('[data-future="activity"]').onclick = () => showComments(!commentsOpen)
element('#save-status').onclick = () => showComments(!commentsOpen)
element('#save-status').setAttribute('role', 'button'); element('#save-status').tabIndex = 0
element('#save-status').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showComments(!commentsOpen) } }
element('#design-mode').addEventListener('click', () => showComments(false))
element('#comment-text').addEventListener('input', updateControls)
document.addEventListener('click', updateControls)
element('#post-comment').onclick = () => {
  const textarea = element<HTMLTextAreaElement>('#comment-text')
  const text = textarea.value.trim(), nodeId = editor.selection()
  if (!text) return
  enqueue(async () => (await api.annotate({ text, ...(nodeId ? { nodeId } : {}) })).state, () => { textarea.value = '' })
}
for (const [id, action] of [['connect-host', 'connect'], ['disconnect-host', 'disconnect'], ['sync-host', 'sync']] as const) {
  element(`#${id}`).onclick = () => {
    // Network/lease errors do not turn confirmed local edits into unsaved edits.
    enqueue(async () => {
      try { return await api.connection(action) }
      catch (error) { element('#host-error').textContent = error instanceof Error ? error.message : String(error); return await api.state() }
    }, undefined, false)
  }
}
element('#reload-saved').onclick = async () => {
  if (pending) return
  if (unconfirmed && !window.confirm('Reload the state saved by the local host? Any unconfirmed draft changes still visible will be discarded.')) return
  try {
    const next = await api.open()
    failed = false; unconfirmed = false; element('#host-error').textContent = ''; element('#reload-saved').classList.add('hidden')
    past.length = 0; future.length = 0; remoteChanged = true; applyState(next, true)
  } catch (error) { failure(error) }
}
element('#export').textContent = 'Export'
element('#export').onclick = async () => {
  if (pending || failed || !ready) return
  try {
    const result = await api.export()
    if (!result.canceled) { showComments(); element('#host-error').textContent = `Exported HTML and chain to ${result.files?.html}` }
  } catch (error) { showComments(); element('#host-error').textContent = error instanceof Error ? error.message : String(error) }
}
window.addEventListener('beforeunload', event => { if (pending || unconfirmed) { event.preventDefault(); event.returnValue = '' } })
async function poll() {
  if (polling || pending || failed || !state) return
  polling = true
  const startedAt = revision
  try { const next = await api.state(); if (startedAt === revision && !pending) applyState(next) }
  catch (error) { failure(error) }
  finally { polling = false }
}
setInterval(() => void poll(), 1000)
document.addEventListener('focusout', () => setTimeout(() => { if (state && !pending && !failed) applyState(state) }, 0))
api.open().then(next => applyState(next, true)).catch(failure)
updateControls()
