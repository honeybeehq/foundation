import {
  candidateOf,
  reviewState,
  runReviewMs,
  type ReviewLog,
  type ReviewRun,
} from "../review/index.ts";
import { defectsOf, valuesOf } from "../accept/index.ts";
const cell = (v: unknown) =>
  String(typeof v === "string" ? v : (JSON.stringify(v) ?? "—"))
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("`", "\\`");
export function jobSummary(
  reports: any[],
  verification: any,
  mode: string,
  artifactUrl: string,
  timings: unknown,
  environmentCauses: string[] = [],
  review?: { log: ReviewLog; run: ReviewRun },
) {
  const lines = [
    "# Design proof",
    `Mode: **${mode}** · ${verification.passed ? "Passed" : "⚠ Drift or incomplete coverage"} · [Download captures, reports and images](${artifactUrl})`,
    "",
    "| State | Verdict | Unique product candidates | Accepted | Raw findings |",
    "|---|---|---:|---:|---:|",
  ];
  for (const r of reports)
    lines.push(
      `| ${cell(r.artboard)} / ${cell(r.state)} | ${r.provable ? (r.summary?.accepted ? `${r.verdict} (accepted differences recorded)` : r.verdict) : "not-provable"} | ${r.provable ? (r.summary?.uniqueDefects ?? defectsOf(r).length) : "—"} | ${r.summary?.accepted ?? 0} | ${r.drifts?.length ?? 0} |`,
    );
  if (review) {
    const items = reports.flatMap((r) =>
      r.provable
        ? defectsOf(r).map((d) => ({ r, d, c: candidateOf(r, d, "") }))
        : [],
    );
    const states = items.map(({ r, d, c }) =>
      reviewState(c, review.log, !!d.accepted),
    );
    lines.push(
      "",
      "## Manual review — advisory only",
      `${states.filter((s) => s.status === "unreviewed").length} unreviewed · ${states.filter((s) => s.status !== "unreviewed").length} carried forward. Real / intended / false-alarm decisions are reviewer observations, not release gates.`,
      "",
      "Scoped IDs below are stable across runs. Download the artifact and start a timed session with \`foundation-proof review-start RUN --reviewer NAME\`, then use \`review RUN SCOPED_ID real|accept|false --note NOTE\`, and finish with \`review-end RUN\`. Keep the downloaded review-index.json and its relative report files together.",
      "",
      "| Reviewed run | Measured review wall time | Decisions |",
      "|---|---:|---:|",
    );
    for (const run of [
      ...new Set(
        review.log.sessions.filter((s) => s.endedAt).map((s) => s.run),
      ),
    ])
      lines.push(
        `| ${cell(run)} | ${(runReviewMs(review.log, run) / 1000).toFixed(1)} s | ${review.log.entries.filter((e) => e.run === run).length} |`,
      );
    if (!review.log.sessions.some((s) => s.endedAt))
      lines.push("| None yet | — | 0 |");
  }
  lines.push("", "## Accepted differences");
  for (const a of verification.accepted ?? [])
    lines.push(`- ${cell(a.state)}: ${cell(a.id)} — ${cell(a.reason)}`);
  if (!verification.accepted?.length) lines.push("None.");
  lines.push(
    "",
    "Candidate groups need review; their count is not a count of confirmed product bugs.",
  );
  for (const r of reports) {
    lines.push("", `## ${cell(r.artboard)} / ${cell(r.state)}`);
    if (!r.provable) {
      lines.push(`**Not provable:** ${cell(r.reason || "Reason missing")}`);
      continue;
    }
    lines.push(
      `Accepted pixel bounds exclude ${((r.acceptedPixels?.excludedRatio ?? 0) * 100).toFixed(3)}% of the image; residual difference outside them: ${((r.acceptedPixels?.residualRatio ?? r.pixels.diffRatio) * 100).toFixed(3)}%. Allowlisted environment groups: ${defectsOf(r).filter((d) => d.classification === "environment" && environmentCauses.includes(d.cause)).length}; unreviewed environment groups: ${defectsOf(r).filter((d) => d.classification === "environment" && !environmentCauses.includes(d.cause)).length}.`,
      `Images: [Design](${artifactUrl}) (\`${cell(r.artboard)}/${cell(r.state)}/design.png\`), [Code](${artifactUrl}) (\`${cell(r.artboard)}/${cell(r.state)}/code.png\`), [Diff](${artifactUrl}) (\`${cell(r.artboard)}/${cell(r.state)}/diff.png\`). Links download the image artifact.`,
      "",
      `<details><summary>Candidate table (${defectsOf(r).length} groups, including uncertain/environment groups)</summary>`,
      "",
      "| Stable scoped ID | Layer (design → code) | What differs | Design → code values | Measurement status | Review |",
      "|---|---|---|---|---|---|",
    );
    for (const d of defectsOf(r))
      lines.push(
        `| ${cell(candidateOf(r, d, "").key)} | ${cell(d.layer.design ?? "—")} → ${cell(d.layer.code ?? "—")} | ${cell(d.summary)} (${cell(d.classification ?? "product")}) | ${valuesOf(
          r,
          d,
        )
          .map(
            (v: any) =>
              `${cell(v.property)}: ${cell(v.design)} → ${cell(v.code)}`,
          )
          .join(
            "; ",
          )} | ${d.accepted ? `Accepted: ${cell(d.accepted.reason)}` : d.classification === "environment" ? (environmentCauses.includes(d.cause) ? "Allowlisted environment" : "Unreviewed environment") : d.classification === "uncertain" ? "Uncertain" : "Drift"} | ${
          review
            ? (() => {
                const s = reviewState(
                  candidateOf(r, d, ""),
                  review.log,
                  !!d.accepted,
                );
                return s.status === "unreviewed"
                  ? s.stale
                    ? "Unreviewed (changed since review)"
                    : "Unreviewed"
                  : `${s.status} — ${cell(s.entry?.note)} (run ${cell(s.entry?.run)})`;
              })()
            : "Not recorded"
        } |`,
      );
    lines.push("", "</details>");
  }
  lines.push(
    "",
    "## Verification",
    ...(verification.errors ?? []).map((e: string) => `- ${cell(e)}`),
    "",
    "## Timings",
    `\`${cell(timings)}\``,
  );
  return lines.join("\n") + "\n";
}
