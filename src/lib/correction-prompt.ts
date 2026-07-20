import type { Claim, Evidence } from "@/types/gbox";

const methodLabels: Record<Evidence["comparisonMethod"], string> = {
  deterministic_adapter: "deterministic adapter",
  model_assisted_mcp: "model-assisted MCP comparison",
  model_assisted_web: "model-assisted web comparison",
  no_comparison: "no completed comparison",
};

export function buildCorrectionPrompt(claim: Claim, evidence: Evidence[]): string {
  const latest = evidence[0];
  const source = latest
    ? `${latest.sourceName} (${latest.sourceReference})`
    : "No authoritative source completed";
  const comparison = latest ? methodLabels[latest.comparisonMethod] : "no completed comparison";
  const evidenceSummary = latest
    ? `${latest.explanation}${latest.content == null ? "" : ` Evidence: ${boundedJson(latest.content)}`}`
    : "gBox could not store supporting evidence.";

  return [
    "Reconsider and correct your prior answer using this gBox verification result.",
    `Original claim: ${claim.statement}`,
    `Verdict: ${claim.state}`,
    `Conflicting evidence: ${evidenceSummary}`,
    `Source: ${source}`,
    `Comparison method: ${comparison}`,
    "State the corrected fact clearly, preserve the source reference, and explain what changed.",
  ].join("\n");
}

function boundedJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized.length <= 800) return serialized;
  return `${serialized.slice(0, 799)}…`;
}
