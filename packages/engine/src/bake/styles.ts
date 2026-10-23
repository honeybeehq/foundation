const layeredStyles = new WeakSet<Record<string, string>>()

export function styleEntries(style: Record<string, string>): [string, string][] {
  const keys = Object.keys(style)
  if (!layeredStyles.has(style)) keys.sort()
  return keys.map((key) => [key, style[key]!])
}

export function mergeStyles(base: Record<string, string>, own: Record<string, string>): Record<string, string> {
  const merged = Object.fromEntries([
    ...styleEntries(base).filter(([key]) => !Object.hasOwn(own, key)),
    ...styleEntries(own),
  ])
  layeredStyles.add(merged)
  return merged
}

export function mapStyleValues(style: Record<string, string>, map: (prop: string, value: string) => string | undefined): Record<string, string> {
  const resolved = Object.fromEntries(styleEntries(style).flatMap(([prop, value]) => {
    const mapped = map(prop, value)
    return mapped === undefined ? [] : [[prop, mapped]]
  }))
  layeredStyles.add(resolved)
  return resolved
}
