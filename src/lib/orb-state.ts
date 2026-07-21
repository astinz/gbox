import type { OrbState } from "thinking-orbs";

import type { LiveActivityModel } from "@/lib/live-activity";
import type { NotchPhase } from "@/lib/notch-presentation";
import type { DashboardSnapshot } from "@/types/gbox";

export type OrbPresentation = {
  state: OrbState;
  paused: boolean;
};

export function orbForNotch(phase: NotchPhase): OrbPresentation {
  if (phase === "captured") return { state: "shaping", paused: false };
  if (phase === "checking") return { state: "searching", paused: false };
  if (phase === "completed") return { state: "solving", paused: true };
  if (phase === "failed") return { state: "working", paused: true };
  return { state: "listening", paused: true };
}

export function orbForActivity(activity: LiveActivityModel): OrbPresentation {
  if (activity.phase === "complete") return { state: "solving", paused: true };
  if (activity.phase === "failed") return { state: "working", paused: true };

  const context = `${activity.headline} ${activity.detail}`.toLowerCase();
  if (containsAny(context, ["source", "search", "evidence", "public"])) {
    return { state: "searching", paused: false };
  }
  if (containsAny(context, ["response", "compos", "writing", "arriving"])) {
    return { state: "composing", paused: false };
  }
  if (containsAny(context, ["approach", "review", "reason", "answer"])) {
    return { state: "solving", paused: false };
  }
  if (containsAny(context, ["project", "updat", "change", "preparing to continue"])) {
    return { state: "shaping", paused: false };
  }
  if (containsAny(context, ["connect", "waiting", "ready"])) {
    return { state: "listening", paused: false };
  }
  return { state: "working", paused: false };
}

export function orbForDashboard(snapshot: DashboardSnapshot): OrbPresentation {
  if (snapshot.observationQueueDepth > 0) return { state: "searching", paused: false };
  if (!snapshot.status.globalObservation) return { state: "listening", paused: true };
  if (!snapshot.status.observationWorkerHealthy) return { state: "working", paused: true };

  const latest = snapshot.recentObservations[0];
  const needsAttention = latest && (
    latest.verdictCounts.contradicted > 0 || latest.verdictCounts.unverifiable > 0
  );
  return needsAttention
    ? { state: "solving", paused: true }
    : { state: "listening", paused: true };
}

function containsAny(value: string, words: string[]): boolean {
  return words.some((word) => value.includes(word));
}
