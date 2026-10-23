export function isJsonValue(value: unknown, active = new Set<object>()): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || active.has(value)) return false
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false
  active.add(value)
  const valid = (Array.isArray(value) ? Array.from(value) : Object.values(value)).every((item) => isJsonValue(item, active))
  active.delete(value)
  return valid
}

export function needsJsonItem(item: Record<string, unknown>): boolean {
  return Object.entries(item).some(([key, value]) => !/^[a-z][a-z0-9_-]*$/.test(key) || key === 'data-fdn-json' || typeof value !== 'string' || /[\u0000-\u001f]/.test(value))
}
