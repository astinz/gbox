import type { Claim, Evidence } from "@/types/gbox";

const methodLabels: Record<Evidence["comparisonMethod"], string> = {
  deterministic_adapter: "exact source comparison",
  model_assisted_mcp: "connected-source comparison",
  model_assisted_web: "public-source comparison",
  no_comparison: "no comparison available",
};

export function buildCorrectionPrompt(claim: Claim, evidence: Evidence[]): string {
  const latest = evidence[0];
  const source = latest
    ? `${sourceDisplayName(latest.sourceName)} (evidence record ${latest.resultHash.slice(0, 16)})`
    : "No suitable evidence source was available";
  const comparison = latest ? methodLabels[latest.comparisonMethod] : "no comparison available";
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

function sourceDisplayName(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes("company_get_metric") || normalized === "company_data") return "Company records";
  if (normalized.includes("web_search")) return "Public web";
  return value.replace(/[\/_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function boundedJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized.length <= 800) return serialized;
  return `${serialized.slice(0, 799)}…`;
}
