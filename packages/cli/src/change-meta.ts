import type { ChangeMeta } from 'foundation-engine'

export function withWallTime(meta: ChangeMeta): ChangeMeta {
  return { ...meta, wallTime: meta.wallTime ?? new Date().toISOString() }
}
