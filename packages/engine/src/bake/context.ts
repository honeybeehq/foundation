import type { FdnDocument, ReportLine } from '../types.js'
import type { ExprContext } from './expr.js'

export function stateContext(doc: FdnDocument, stateName: string | null, reports: ReportLine[] = []): ExprContext {
  const state = stateName === null ? undefined : doc.states.find(item => item.name === stateName)
  if (stateName !== null && !state) reports.push({ code: 'unknown-state', severity: 'error', message: `state "${stateName}" is not declared; baking with defaults only` })
  const params: Record<string, unknown> = {}
  for (const param of doc.params) {
    if (state && Object.hasOwn(state.assignments, param.name)) params[param.name] = state.assignments[param.name]
    else if (param.default !== undefined) params[param.name] = param.default
    else {
      params[param.name] = ''
      reports.push({ code: 'param-missing-default', severity: 'warning', message: `param "${param.name}" has no default and no state assignment; baked empty` })
    }
  }
  return { bindings: { prop: {}, param: params, state: { name: stateName ?? '' } }, lookups: doc.lookups }
}
