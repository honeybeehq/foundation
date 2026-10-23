import { artboardPages, explicitArtboards, selectArtboard } from 'foundation-engine'
import type { FdnDocument, BoardRef, ReportLine } from 'foundation-engine'
import { LEGACY_SESSION_PROTOCOL } from 'foundation-protocol'
import type { LegacyServiceMessage, ServiceMessage } from 'foundation-protocol'

export const legacyArtboardReason = 'This design uses artboards. Update Apiary to edit it; this client can only view the first board.'
export const legacyArtboardOpReason = 'Artboard edits require an updated client. This legacy connection cannot upgrade a design.'

export function legacyBoardRef(doc: FdnDocument, state: string | null): BoardRef {
  return { artboardId: explicitArtboards(doc) ? artboardPages(doc).flatMap(page => page.artboardIds)[0] ?? null : null, state, viewport: null }
}

function legacyDocument(doc: FdnDocument): FdnDocument {
  if (!explicitArtboards(doc)) return doc
  const first = legacyBoardRef(doc, null).artboardId
  if (first === null) return { ...doc, body: [] }
  return selectArtboard(doc, first).doc
}

function warning(): ReportLine {
  return { code: 'legacy-client-artboards-read-only', severity: 'warning', message: legacyArtboardReason }
}

export function legacyMessage(message: ServiceMessage): LegacyServiceMessage {
  if (message.t === 'welcome' || message.t === 'doc') {
    const { pages, boards, unavailableBoards, ...view } = message
    const readOnly = explicitArtboards(message.doc)
    const common = { ...view, doc: legacyDocument(message.doc), history: readOnly ? { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null } : view.history, issues: readOnly ? [...view.issues, warning()] : view.issues }
    return message.t === 'welcome' ? { ...common, t: 'welcome', protocol: LEGACY_SESSION_PROTOCOL, path: message.path, docId: message.docId, chain: message.chain, created: message.created } : { ...common, t: 'doc', cause: message.cause }
  }
  if (message.t === 'baked') return { t: 'baked', rev: message.rev, state: message.state, html: message.html, report: message.artboardId === null ? message.report : [...message.report, warning()] }
  if (message.t === 'baked-diff') return { t: 'baked-diff', rev: message.rev, state: message.state, baseRev: message.baseRev, start: message.start, deleteCount: message.deleteCount, insert: message.insert, report: message.artboardId === null ? message.report : [...message.report, warning()] }
  return message
}
