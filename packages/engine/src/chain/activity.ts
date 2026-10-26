import type { Change, ContainerID, JsonOp, LoroDoc, LoroMap, OpId } from 'loro-crdt'
import type { ChainActivityOptions, ChainActivityPage, ChainLogEntry, ChainLogOptions, ChainLogPage, ChainLogSection } from '../types.js'
import { comparePeerIds } from './util.js'
import { computeEnvelopeHash, decodeEnvelope } from './envelope.js'

const SECTIONS = new Set<ChainLogSection>(['tokens', 'tokenCollections', 'componentSets', 'params', 'data', 'lookups', 'states', 'viewports', 'matrix', 'namedStyles', 'components', 'annotations', 'meta'])
const cursorOf = (change: Change): string => `log1:${change.lamport}:${change.peer}:${change.counter}`
const compareChanges = (a: Change, b: Change): number => a.lamport - b.lamport || comparePeerIds(a.peer, b.peer) || a.counter - b.counter
const encodeToken = (prefix: string, value: unknown): string => prefix + Buffer.from(JSON.stringify(value)).toString('base64url')
const invalidToken = (): never => { throw new Error('invalid or stale activity token; establish a new baseline') }
const isPoint = (value: unknown): value is OpId => typeof value === 'object' && value !== null && 'peer' in value && typeof value.peer === 'string' && /^\d+$/.test(value.peer) && 'counter' in value && Number.isSafeInteger(value.counter) && (value.counter as number) >= 0
type BoundPoint = OpId & { hash: string }

function decodeToken(token: string, prefix: string): unknown {
  if (!token.startsWith(prefix)) return invalidToken()
  const payload = token.slice(prefix.length)
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) return invalidToken()
  const bytes = Buffer.from(payload, 'base64url')
  if (bytes.toString('base64url') !== payload) return invalidToken()
  try { return JSON.parse(bytes.toString('utf8')) } catch { return invalidToken() }
}

export function emptyActivityPage(docId: string | null): ChainActivityPage {
  return { entries: [], frontier: encodeToken('activity1:', { docId, points: [] }), nextCursor: null, hasMore: false }
}

export class ChainActivity {
  private frontiers: OpId[] = []
  private changes: Change[] = []
  private positions = new Map<string, number>()
  private owners = new Map<ContainerID, string | null>()
  private entries = new Map<string, ChainLogEntry>()
  private hashes = new Map<string, string>()

  constructor(private readonly doc: LoroDoc, private readonly docId: () => string | null, private readonly originalBytes: (change: Change) => Uint8Array) {}

  read(opts: ChainActivityOptions = {}, anchors: ReadonlyMap<string, readonly { peer: string; counter: number }[]> = new Map()): ChainActivityPage {
    const requested = opts.limit ?? 200
    if (!Number.isSafeInteger(requested) || requested < 1) throw new Error('activity limit must be a positive integer')
    if (opts.since !== undefined && opts.cursor !== undefined) throw new Error('activity accepts since or cursor, not both')
    const limit = Math.min(requested, 200)
    let base: string
    let target: string
    let before: OpId | undefined
    if (opts.cursor !== undefined) {
      const cursor = decodeToken(opts.cursor, 'activity-page1:')
      if (typeof cursor !== 'object' || cursor === null || !('base' in cursor) || typeof cursor.base !== 'string' || !('target' in cursor) || typeof cursor.target !== 'string' || !('before' in cursor) || !isPoint(cursor.before)) return invalidToken()
      base = cursor.base
      target = cursor.target
      before = cursor.before
    } else {
      target = this.frontierToken(this.doc.oplogFrontiers())
      if (opts.since === undefined) return { entries: [], frontier: target, nextCursor: null, hasMore: false }
      base = opts.since
    }
    const from = this.parseFrontier(base)
    const to = this.parseFrontier(target)
    const difference = this.doc.findIdSpansBetween(from, to)
    if (difference.retreat.length) return invalidToken()
    let boundary: Change | undefined
    if (before) {
      try { boundary = this.doc.getChangeAt(before) } catch { return invalidToken() }
    }
    if (boundary && (boundary.counter !== before!.counter || !difference.forward.some(span => span.peer === boundary.peer && span.counter <= boundary.counter && boundary.counter < span.counter + span.length))) return invalidToken()
    const pending: Array<{ low: number; change: Change }> = []
    for (const span of difference.forward) {
      let change: Change | undefined = this.doc.getChangeAt({ peer: span.peer, counter: span.counter + span.length - 1 })
      if (boundary && compareChanges(change, boundary) >= 0) {
        change = this.doc.getChangeAtLamport(span.peer, boundary.lamport)
        if (change && compareChanges(change, boundary) >= 0) change = change.counter > span.counter ? this.doc.getChangeAt({ peer: span.peer, counter: change.counter - 1 }) : undefined
      }
      if (change && change.counter >= span.counter) pending.push({ low: span.counter, change })
    }
    pending.sort((a, b) => compareChanges(b.change, a.change))
    const selected: Change[] = []
    while (selected.length < limit && pending.length) {
      const item = pending.shift()!
      selected.push(item.change)
      if (item.change.counter > item.low) {
        item.change = this.doc.getChangeAt({ peer: item.change.peer, counter: item.change.counter - 1 })
        let low = 0, high = pending.length
        while (low < high) {
          const middle = (low + high) >>> 1
          if (compareChanges(pending[middle]!.change, item.change) > 0) low = middle + 1
          else high = middle
        }
        pending.splice(low, 0, item)
      }
    }
    const last = selected.at(-1)
    return {
      entries: this.withAnchors(selected, anchors),
      frontier: target,
      nextCursor: pending.length && last ? encodeToken('activity-page1:', { base, target, before: { peer: last.peer, counter: last.counter } }) : null,
      hasMore: pending.length > 0,
    }
  }

  private frontierToken(frontiers: OpId[]): string {
    const points: BoundPoint[] = [...frontiers].sort((a, b) => comparePeerIds(a.peer, b.peer)).map(point => ({ ...point, hash: this.hash(this.doc.getChangeAt(point)) }))
    return encodeToken('activity1:', { docId: this.docId(), points })
  }

  private parseFrontier(token: string): OpId[] {
    const value = decodeToken(token, 'activity1:')
    if (typeof value !== 'object' || value === null || !('docId' in value) || value.docId !== this.docId() || !('points' in value) || !Array.isArray(value.points)) return invalidToken()
    const seen = new Set<string>()
    return value.points.map((point: unknown) => {
      if (!isPoint(point) || !('hash' in point) || typeof point.hash !== 'string' || !/^[a-f0-9]{64}$/.test(point.hash) || seen.has(point.peer)) return invalidToken()
      seen.add(point.peer)
      let change: Change
      try { change = this.doc.getChangeAt(point) } catch { return invalidToken() }
      if (point.counter !== change.counter + change.length - 1 || this.hash(change) !== point.hash) return invalidToken()
      return { peer: point.peer, counter: point.counter }
    })
  }


  page(opts: ChainLogOptions = {}, anchors: ReadonlyMap<string, readonly { peer: string; counter: number }[]> = new Map()): ChainLogPage {
    const requested = opts.limit ?? 50
    if (!Number.isInteger(requested) || requested < 0) throw new Error('log limit must be a nonnegative integer')
    const limit = Math.min(requested, 200)
    this.refresh()
    const position = (cursor: string): number => {
      const value = this.positions.get(cursor)
      if (value === undefined) throw new Error('unknown log cursor; reload the latest page')
      return value
    }
    const end = opts.before === undefined ? this.changes.length : position(opts.before)
    const from = Math.max(0, end - limit)
    const selected = end > 0 && limit > 0 ? this.changes.slice(from, end).reverse() : []
    const hasMore = selected.length > 0 && from > 0
    return {
      entries: this.withAnchors(selected, anchors),
      nextCursor: hasMore ? cursorOf(selected[selected.length - 1]!) : null,
      latestCursor: this.changes.length ? cursorOf(this.changes[this.changes.length - 1]!) : null,
      hasMore,
    }
  }

  private withAnchors(changes: Change[], anchors: ReadonlyMap<string, readonly { peer: string; counter: number }[]>): ChainLogEntry[] {
    const names = new Map<string, string[]>()
    for (const [name, frontier] of anchors) {
      for (const point of frontier) {
        const key = `${point.peer}:${point.counter}`
        const list = names.get(key) ?? []
        list.push(name)
        names.set(key, list)
      }
    }
    return changes.map(change => ({
      ...this.entry(change),
      anchors: (names.get(`${change.peer}:${change.counter + change.length - 1}`) ?? []).sort(),
    }))
  }

  private refresh(): void {
    const target = this.doc.oplogFrontiers()
    const difference = this.doc.findIdSpansBetween(this.frontiers, target)
    if (!difference.forward.length) return
    const added: Change[] = []
    for (const span of difference.forward) {
      for (let counter = span.counter; counter < span.counter + span.length;) {
        const change = this.doc.getChangeAt({ peer: span.peer, counter })
        added.push(change)
        counter = change.counter + change.length
      }
    }
    added.sort(compareChanges)
    if (!this.changes.length || compareChanges(this.changes.at(-1)!, added[0]!) < 0) {
      for (const change of added) {
        this.positions.set(cursorOf(change), this.changes.length)
        this.changes.push(change)
      }
    } else {
      const merged: Change[] = []
      let left = 0, right = 0
      while (left < this.changes.length && right < added.length) merged.push(compareChanges(this.changes[left]!, added[right]!) < 0 ? this.changes[left++]! : added[right++]!)
      this.changes = merged.concat(this.changes.slice(left), added.slice(right))
      this.positions = new Map(this.changes.map((change, index) => [cursorOf(change), index]))
    }
    this.frontiers = target
  }

  private owner(container: ContainerID): string | null {
    if (this.owners.has(container)) return this.owners.get(container)!
    let current = this.doc.getContainerById(container)
    let owner: string | null = null
    while (current) {
      if (current.kind() === 'Map' && current.parent()?.id === 'cid:root-tree:Tree') {
        const value = (current as LoroMap).get('id')
        if (typeof value === 'string') owner = value
        break
      }
      current = current.parent()
    }
    if (this.owners.size >= 2048) this.owners.clear()
    if (owner !== null) this.owners.set(container, owner)
    return owner
  }

  private entry(change: Change): ChainLogEntry {
    const cursor = cursorOf(change)
    const cached = this.entries.get(cursor)
    if (cached) return structuredClone(cached)
    const inserted = new Set<string>()
    const removed = new Set<string>()
    const changed = new Set<string>()
    const sections = new Map<ChainLogSection, Set<string>>()
    let factsComplete = true
    let context: { artboardIds: string[]; pageIds: string[] } | undefined
    let anchor: ChainLogEntry['anchor']
    const section = (name: ChainLogSection, key: string): void => {
      const names = sections.get(name) ?? new Set<string>()
      names.add(key)
      sections.set(name, names)
    }
    const touch = (op: JsonOp): void => {
      const content = op.content
      if (op.container === 'cid:root-meta:Map' && 'key' in content && content.key === 'artboardActivity') {
        try {
          const value = 'value' in content && typeof content.value === 'string' ? JSON.parse(content.value) : null
          if (value && Array.isArray(value.artboardIds) && Array.isArray(value.pageIds) && Array.isArray(value.insertedNodeIds) && Array.isArray(value.removedNodeIds) && [...value.artboardIds, ...value.pageIds, ...value.insertedNodeIds, ...value.removedNodeIds].every(id => typeof id === 'string')) {
            context = { artboardIds: value.artboardIds, pageIds: value.pageIds }
            for (const id of value.insertedNodeIds) inserted.add(id)
            for (const id of value.removedNodeIds) removed.add(id)
          }
          else factsComplete = false
        } catch { factsComplete = false }
        return
      }
      if (op.container === 'cid:root-tree:Tree' && 'target' in content) {
        const id = this.owner(`cid:${content.target}:Map`)
        if (id === null) factsComplete = false
        else if (content.type === 'create') inserted.add(id)
        else if (content.type === 'delete') removed.add(id)
        else changed.add(id)
        return
      }
      if (op.container === 'cid:root-meta:Map' && 'key' in content && content.key === 'namedVersion') {
        try {
          const value: unknown = 'value' in content && typeof content.value === 'string' ? JSON.parse(content.value) : null
          if (typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string' && 'targetHash' in value && (value.targetHash === null || typeof value.targetHash === 'string')) {
            anchor = { name: value.name, targetHash: value.targetHash }
          } else factsComplete = false
        } catch {
          factsComplete = false
        }
        return
      }
      const root = /^cid:root-([^:]+):/.exec(op.container)?.[1]
      if (root) {
        if (root === 'order' && 'key' in content && SECTIONS.has(content.key as ChainLogSection)) {
          section(content.key as ChainLogSection, '*')
        } else if (SECTIONS.has(root as ChainLogSection)) {
          section(root as ChainLogSection, 'key' in content ? content.key : '*')
        } else factsComplete = false
        return
      }
      const id = this.owner(op.container)
      if (id === null) factsComplete = false
      else changed.add(id)
    }
    for (const fragment of this.doc.exportJsonInIdSpan({ peer: change.peer, counter: change.counter, length: change.length })) {
      for (const op of fragment.ops) touch(op)
    }
    for (const id of inserted) changed.delete(id)
    for (const id of removed) changed.delete(id)
    const decoded = decodeEnvelope(change.message)
    const entry: ChainLogEntry = {
      hash: this.hash(change),
      ...decoded,
      cursor,
      anchors: [],
      ...(anchor ? { anchor } : {}),
      time: { kind: 'logical', value: change.timestamp },
      wallTime: decoded.wallTime ?? null,
      originNode: decoded.originNode ?? null,
      originAssurance: null,
      nodeIds: [...new Set([...inserted, ...removed, ...changed])].sort(),
      nodes: { inserted: [...inserted].sort(), removed: [...removed].sort(), changed: [...changed].sort() },
      sections: [...sections].sort(([a], [b]) => a.localeCompare(b)).map(([name, names]) => ({ section: name, names: [...names].sort() })),
      factsComplete,
      ...context,
    }
    if (factsComplete) {
      if (this.entries.size >= 256) this.entries.delete(this.entries.keys().next().value!)
      this.entries.set(cursor, entry)
    }
    return structuredClone(entry)
  }

  private hash(change: Change): string {
    const key = `${cursorOf(change)}:${change.length}`
    const cached = this.hashes.get(key)
    if (cached) return cached
    const decoded = decodeEnvelope(change.message)
    const bytes = this.originalBytes(change)
    const hash = computeEnvelopeHash(decoded.prevHash, decoded.author, decoded.message, decoded.specVersion, bytes)
    if (this.hashes.size >= 256) this.hashes.delete(this.hashes.keys().next().value!)
    this.hashes.set(key, hash)
    return hash
  }
}
