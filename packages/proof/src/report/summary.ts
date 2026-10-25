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
      `| ${cell(r.state)} | ${r.provable ? (r.summary?.accepted ? `${r.verdict} (accepted differences recorded)` : r.verdict) : "not-provable"} | ${r.provable ? (r.summary?.uniqueDefects ?? defectsOf(r).length) : "—"} | ${r.summary?.accepted ?? 0} | ${r.drifts?.length ?? 0} |`,
    );
  lines.push("", "## Accepted differences");
  for (const a of verification.accepted ?? [])
    lines.push(`- ${cell(a.state)}: ${cell(a.id)} — ${cell(a.reason)}`);
  if (!verification.accepted?.length) lines.push("None.");
  lines.push(
    "",
    "Candidate groups need review; their count is not a count of confirmed product bugs.",
  );
  for (const r of reports) {
    lines.push("", `## ${cell(r.state)}`);
    if (!r.provable) {
      lines.push(`**Not provable:** ${cell(r.reason || "Reason missing")}`);
      continue;
    }
    lines.push(
      `Accepted pixel bounds exclude ${((r.acceptedPixels?.excludedRatio ?? 0) * 100).toFixed(3)}% of the image; residual difference outside them: ${((r.acceptedPixels?.residualRatio ?? r.pixels.diffRatio) * 100).toFixed(3)}%. Allowlisted environment groups: ${defectsOf(r).filter((d) => d.classification === "environment" && environmentCauses.includes(d.cause)).length}; unreviewed environment groups: ${defectsOf(r).filter((d) => d.classification === "environment" && !environmentCauses.includes(d.cause)).length}.`,
      `Images: [Design](${artifactUrl}) (\`${cell(r.state)}/design.png\`), [Code](${artifactUrl}) (\`${cell(r.state)}/code.png\`), [Diff](${artifactUrl}) (\`${cell(r.state)}/diff.png\`). Links download the image artifact.`,
      "",
      `<details><summary>Candidate table (${defectsOf(r).length} groups, including uncertain/environment groups)</summary>`,
      "",
      "| Layer (design → code) | What differs | Design → code values | Status |",
      "|---|---|---|---|",
    );
    for (const d of defectsOf(r))
      lines.push(
        `| ${cell(d.layer.design ?? "—")} → ${cell(d.layer.code ?? "—")} | ${cell(d.summary)} (${cell(d.classification ?? "product")}) | ${valuesOf(
          r,
          d,
        )
          .map(
            (v: any) =>
              `${cell(v.property)}: ${cell(v.design)} → ${cell(v.code)}`,
          )
          .join(
            "; ",
          )} | ${d.accepted ? `Accepted: ${cell(d.accepted.reason)}` : d.classification === "environment" ? (environmentCauses.includes(d.cause) ? "Allowlisted environment" : "Unreviewed environment") : d.classification === "uncertain" ? "Uncertain" : "Drift"} |`,
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
