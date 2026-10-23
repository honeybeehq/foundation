import { excludedStylePropertyMessage, OVERLAY_ONLY_POSITION_VALUES } from '../grammar/schema.js'
import type { ReportLine } from '../types.js'

export function validateStyleDeclarations(decls: Record<string, string>, opts: { nodeId?: string; allowOverlayPosition: boolean; allowFreePosition?: boolean; label: string }): ReportLine[] {
  const issues: ReportLine[] = []
  for (const [prop, value] of Object.entries(decls)) {
    const excludedMsg = excludedStylePropertyMessage(prop)
    if (excludedMsg) {
      issues.push({
        code: 'excluded-style-property',
        severity: 'error',
        message: excludedMsg,
        ...(opts.nodeId ? { nodeId: opts.nodeId } : {}),
        detail: { property: prop, value, on: opts.label },
      })
    }
    if (/!important/i.test(value)) {
      issues.push({
        code: 'important-not-allowed',
        severity: 'error',
        message: `"${prop}: ${value}" uses !important — the subset's cascade is local and total, !important is not legal`,
        ...(opts.nodeId ? { nodeId: opts.nodeId } : {}),
        detail: { property: prop, value, on: opts.label },
      })
    }
    if (/[{}]/.test(value.replace(/\{\{[\s\S]*?\}\}/g, ''))) {
      issues.push({
        code: 'embedded-rule-not-allowed',
        severity: 'error',
        message: `"${prop}: ${value}" looks like it embeds a CSS rule/selector — declare a named style instead (no descendant selectors, no specificity games)`,
        ...(opts.nodeId ? { nodeId: opts.nodeId } : {}),
        detail: { property: prop, value, on: opts.label },
      })
    }
    if (prop === 'position' && OVERLAY_ONLY_POSITION_VALUES.includes(value.trim())) {
      if (!opts.allowOverlayPosition && !(opts.allowFreePosition && value.trim() === 'absolute')) {
        issues.push({
          code: 'position-outside-overlay',
          severity: 'error',
          message: `position:${value.trim()} needs a positioned frame parent for absolute placement, or <fdn-overlay> for absolute/fixed placement`,
          ...(opts.nodeId ? { nodeId: opts.nodeId } : {}),
          detail: { property: prop, value, on: opts.label },
        })
      }
    }
  }
  return issues
}
