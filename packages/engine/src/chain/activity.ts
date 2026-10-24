import type { Change, ContainerID, JsonOp, LoroDoc, LoroMap } from 'loro-crdt'
import type { ChainLogEntry, ChainLogOptions, ChainLogPage, ChainLogSection } from '../types.js'
import { comparePeerIds } from './util.js'
import { computeEnvelopeHash, decodeEnvelope } from './envelope.js'

const SECTIONS = new Set<ChainLogSection>(['tokens', 'tokenCollections', 'componentSets', 'params', 'data', 'lookups', 'states', 'viewports', 'matrix', 'namedStyles', 'components', 'annotations', 'meta'])
const cursorOf = (change: Change): string => `log1:${change.lamport}:${change.peer}:${change.counter}`

export class ChainActivity {
  private version = ''
  private changes: Change[] = []
  private positions = new Map<string, number>()
  private owners = new Map<ContainerID, string | null>()
  private entries = new Map<string, ChainLogEntry>()

  constructor(private readonly doc: LoroDoc) {}

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
    const names = new Map<string, string[]>()
    for (const [name, frontier] of anchors) {
      for (const point of frontier) {
        const key = `${point.peer}:${point.counter}`
        const list = names.get(key) ?? []
        list.push(name)
        names.set(key, list)
      }
    }
    return {
      entries: selected.map(change => ({
        ...this.entry(change),
        anchors: (names.get(`${change.peer}:${change.counter + change.length - 1}`) ?? []).sort(),
      })),
      nextCursor: hasMore ? cursorOf(selected[selected.length - 1]!) : null,
      latestCursor: this.changes.length ? cursorOf(this.changes[this.changes.length - 1]!) : null,
      hasMore,
    }
  }

  private refresh(): void {
    const version = JSON.stringify([...this.doc.oplogVersion().toJSON()].sort(([a], [b]) => comparePeerIds(a, b)))
    if (version === this.version) return
    this.changes = [...this.doc.getAllChanges().values()].flat()
    this.changes.sort((a, b) => a.lamport - b.lamport || comparePeerIds(a.peer, b.peer) || a.counter - b.counter)
    this.positions = new Map(this.changes.map((change, index) => [cursorOf(change), index]))
    this.owners.clear()
    this.entries.clear()
    this.version = version
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
    this.owners.set(container, owner)
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
    const bytes = this.doc.export({ mode: 'updates-in-range', spans: [{ id: { peer: change.peer, counter: change.counter }, len: change.length }] })
    const entry: ChainLogEntry = {
      hash: computeEnvelopeHash(decoded.prevHash, decoded.author, decoded.message, decoded.specVersion, bytes),
      ...decoded,
      cursor,
      anchors: [],
      ...(anchor ? { anchor } : {}),
      time: { kind: 'logical', value: change.timestamp },
      wallTime: decoded.wallTime ?? null,
      originNode: decoded.originNode ?? null,
      nodeIds: [...new Set([...inserted, ...removed, ...changed])].sort(),
      nodes: { inserted: [...inserted].sort(), removed: [...removed].sort(), changed: [...changed].sort() },
      sections: [...sections].sort(([a], [b]) => a.localeCompare(b)).map(([name, names]) => ({ section: name, names: [...names].sort() })),
      factsComplete,
      ...context,
    }
    if (this.entries.size >= 256) this.entries.delete(this.entries.keys().next().value!)
    this.entries.set(cursor, entry)
    return structuredClone(entry)
  }
}
