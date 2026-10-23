import type { FdnDocument, FdnNode, FdnToken, FdnTokenType, FdnTokenValue, ReportLine } from '../types.js'

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_-]*$/
const COLLECTION = /^[a-z][a-z0-9-]*$/
const MODE = /^[a-zA-Z][a-zA-Z0-9_-]*$/
const TYPES: FdnTokenType[] = ['color', 'number', 'string', 'boolean']

export function isTokenAlias(value: FdnTokenValue): value is { alias: string } {
  return typeof value === 'object' && value !== null && 'alias' in value
}

export function tokenValueCss(value: FdnTokenValue, type: FdnTokenType): string {
  if (isTokenAlias(value)) return `var(--${value.alias})`
  if (typeof value !== 'string' || type === 'color') return String(value)
  return `"${[...value].map((c) => c === '\\' || c === '"' ? `\\${c}` : c === '<' || c.charCodeAt(0) < 32 ? `\\${c.charCodeAt(0).toString(16)} ` : c).join('')}"`
}

function literalMatches(value: FdnTokenValue, type: FdnTokenType): boolean {
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'string') return typeof value === 'string' && !value.includes('\0')
  return typeof value === 'string' && (/^#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{4}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})$/.test(value) || value === 'transparent')
}

export function validateTokenCollections(doc: FdnDocument): ReportLine[] {
  const collections = doc.tokenCollections ?? []
  const hasSelection = (nodes: FdnNode[]): boolean => nodes.some((node) => Object.keys(node.attrs).some((key) => key.startsWith('data-fdn-mode-')) || hasSelection(node.children))
  if (collections.length === 0 && !hasSelection(doc.body) && !doc.components.some((component) => hasSelection(component.body))) return []
  const issues: ReportLine[] = []
  const fail = (message: string) => issues.push({ code: 'invalid-token-collection', severity: 'error', message })
  const names = new Set(Object.keys(doc.tokens))
  const collectionNames = new Set<string>()
  const tokens = new Map<string, FdnToken>()
  for (const collection of collections) {
    if (!COLLECTION.test(collection.name) || collectionNames.has(collection.name)) fail(`collection "${collection.name}" needs a unique lowercase CSS-safe name`)
    collectionNames.add(collection.name)
    if (collection.modes.length === 0 || new Set(collection.modes).size !== collection.modes.length || collection.modes.some((mode) => !MODE.test(mode))) fail(`collection "${collection.name}" needs unique CSS-safe mode names and at least one mode`)
    for (const token of collection.tokens) {
      if (!IDENT.test(token.name) || names.has(token.name)) fail(`token "${token.name}" needs a unique CSS custom-property name across flat tokens and collections`)
      names.add(token.name)
      tokens.set(token.name, token)
      if (!TYPES.includes(token.type)) fail(`token "${token.name}" has unknown type "${token.type}"`)
      if (Object.keys(token.values).length !== collection.modes.length || collection.modes.some((mode) => !Object.hasOwn(token.values, mode))) fail(`token "${token.name}" needs exactly one value for every mode in "${collection.name}"`)
    }
  }
  const aliasType = (name: string, seen = new Set<string>()): FdnTokenType | undefined => {
    const typed = tokens.get(name)
    if (typed) return typed.type
    if (seen.has(name)) return undefined
    seen.add(name)
    const raw = Object.hasOwn(doc.tokens, name) ? doc.tokens[name] : undefined
    if (raw === undefined) return undefined
    const alias = /^var\(\s*--([a-zA-Z0-9_-]+)\s*\)$/.exec(raw)
    if (alias) return aliasType(alias[1]!, seen)
    if (literalMatches(raw, 'color')) return 'color'
    if (raw === 'true' || raw === 'false') return 'boolean'
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) && Number.isFinite(Number(raw))) return 'number'
    if (/^"(?:[^"\\]|\\.)*"$/.test(raw)) return 'string'
    return undefined
  }
  const edges = new Map<string, Array<{ target: string; collection?: string; mode?: string }>>()
  for (const [name, value] of Object.entries(doc.tokens)) edges.set(name, [...value.matchAll(/var\(\s*--([a-zA-Z0-9_-]+)/g)].map((match) => ({ target: match[1]! })))
  for (const collection of collections) {
    for (const token of collection.tokens) {
      const refs: Array<{ target: string; collection: string; mode: string }> = []
      for (const [mode, value] of Object.entries(token.values)) {
        if (isTokenAlias(value)) {
          if (!IDENT.test(value.alias) || !names.has(value.alias) || aliasType(value.alias) !== token.type) fail(`alias from "${token.name}" to "${value.alias}" must name a declared token of type ${token.type}`)
          refs.push({ target: value.alias, collection: collection.name, mode })
        } else if (!literalMatches(value, token.type)) fail(`token "${token.name}" mode "${mode}" needs a ${token.type} literal or same-type alias`)
      }
      edges.set(token.name, refs)
    }
  }
  const acyclic = new Set<string>()
  const visit = (name: string, active: Set<string>, selected: Map<string, string>): boolean => {
    if (active.has(name)) return true
    const key = JSON.stringify([name, [...selected].sort(([a], [b]) => a.localeCompare(b))])
    if (acyclic.has(key)) return false
    const nextActive = new Set(active).add(name)
    for (const edge of edges.get(name) ?? []) {
      if (edge.collection && selected.has(edge.collection) && selected.get(edge.collection) !== edge.mode) continue
      const next = new Map(selected)
      if (edge.collection) next.set(edge.collection, edge.mode!)
      if (visit(edge.target, nextActive, next)) return true
    }
    acyclic.add(key)
    return false
  }
  if ([...edges.keys()].some((name) => visit(name, new Set(), new Map()))) fail('token aliases form a cycle in a possible collection-mode combination')
  const walk = (nodes: FdnNode[]) => {
    for (const node of nodes) {
      for (const [key, value] of Object.entries(node.attrs)) {
        if (!key.startsWith('data-fdn-mode-')) continue
        const collection = collections.find((item) => item.name === key.slice('data-fdn-mode-'.length))
        if (!collection || !collection.modes.includes(value)) fail(`node "${node.id}" selects unknown collection mode ${key}="${value}"`)
      }
      walk(node.children)
    }
  }
  walk(doc.body)
  for (const component of doc.components) walk(component.body)
  return issues
}

export function collectionCss(doc: FdnDocument): string[] {
  if (!doc.tokenCollections?.length || validateTokenCollections(doc).length) return []
  const lines: string[] = []
  const aliases = Object.entries(doc.tokens).filter(([, value]) => value.includes('var(')).sort(([a], [b]) => a.localeCompare(b))
  if (aliases.length) {
    lines.push(':where(*) {')
    for (const [name, value] of aliases) lines.push(`  --${name}: ${value};`)
    lines.push('}')
  }
  for (const collection of [...doc.tokenCollections].sort((a, b) => a.name.localeCompare(b.name))) {
    for (const mode of collection.modes) {
      const rules = [`[data-fdn-mode-${collection.name}="${mode}"]`]
      if (mode === collection.modes[0]) rules.unshift(':root')
      for (const selector of rules) {
        lines.push(`@scope (${selector}) {`, '  :scope, :scope * {')
        for (const token of [...collection.tokens].sort((a, b) => a.name.localeCompare(b.name))) lines.push(`    --${token.name}: ${tokenValueCss(token.values[mode]!, token.type)};`)
        lines.push('  }', '}')
      }
    }
  }
  return lines
}
