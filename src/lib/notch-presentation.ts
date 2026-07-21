import type { Observation } from "@/types/gbox";

export type NotchPhase = "watching" | "captured" | "checking" | "completed" | "failed";

export type NotchVerdict = "contradicted" | "unverifiable" | "verified" | "none";

export function observationVerdict(observation?: Observation): NotchVerdict {
  if (!observation) return "none";
  if (observation.verdictCounts.contradicted > 0) return "contradicted";
  if (observation.verdictCounts.unverifiable > 0) return "unverifiable";
  if (observation.verdictCounts.verified > 0) return "verified";
  return "none";
}

export function phaseLabel(phase: NotchPhase, observation?: Observation): string {
  if (phase === "watching") return "Watching";
  if (phase === "captured") return "Captured";
  if (phase === "checking") return "Checking";
  if (phase === "failed") return "Check failed";
  const verdict = observationVerdict(observation);
  if (verdict === "contradicted") return "Contradicted";
  if (verdict === "unverifiable") return "Needs review";
  if (verdict === "verified") return "Verified";
  return "No material claim";
}

export function verdictSummary(observation?: Observation): string {
  if (!observation) return "Waiting for completed research";
  const counts = observation.verdictCounts;
  return `${counts.contradicted} contradicted · ${counts.unverifiable} review · ${counts.verified} verified`;
}

export function shouldExpandNotch(
  hovered: boolean,
  phase: NotchPhase,
  observation?: Observation,
): boolean {
  return hovered || (
    phase === "completed" && observationVerdict(observation) === "contradicted"
  );
}
