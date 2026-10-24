import { hostname } from 'node:os'
import type { ChangeMeta } from 'foundation-engine'

export function withWallTime(meta: ChangeMeta): ChangeMeta {
  return { ...meta, wallTime: meta.wallTime ?? new Date().toISOString(), originNode: meta.originNode ?? originNode() }
}

export function originNode(): string {
  return process.env.FOUNDATION_ORIGIN_NODE ?? hostname()
}
