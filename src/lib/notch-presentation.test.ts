import { describe, expect, it } from "vitest";

import {
  observationVerdict,
  phaseLabel,
  shouldExpandNotch,
} from "@/lib/notch-presentation";
import type { Observation } from "@/types/gbox";

function observation(verified: number, contradicted: number, unverifiable: number): Observation {
  return {
    id: "observation",
    sessionId: "codex-session",
    source: "codex-stop-hook",
    messageHash: "hash",
    messageExcerpt: "A captured claim",
    state: "Completed",
    attempts: 1,
    verdictCounts: { verified, contradicted, unverifiable },
    notificationState: "Pending",
    createdAt: "2026-07-21T00:00:00Z",
  };
}

describe("notch presentation", () => {
  it("prioritizes contradicted over unverifiable and verified verdicts", () => {
    const result = observation(1, 1, 1);
    expect(observationVerdict(result)).toBe("contradicted");
    expect(phaseLabel("completed", result)).toBe("Contradicted");
  });

  it("labels completed turns without material claims", () => {
    expect(phaseLabel("completed", observation(0, 0, 0))).toBe("No material claim");
  });

  it("expands only for hover or a newly completed contradiction", () => {
    expect(shouldExpandNotch(true, "watching", observation(1, 0, 0))).toBe(true);
    expect(shouldExpandNotch(false, "captured", observation(0, 0, 0))).toBe(false);
    expect(shouldExpandNotch(false, "checking", observation(0, 0, 0))).toBe(false);
    expect(shouldExpandNotch(false, "completed", observation(1, 0, 0))).toBe(false);
    expect(shouldExpandNotch(false, "completed", observation(0, 0, 1))).toBe(false);
    expect(shouldExpandNotch(false, "completed", observation(0, 1, 0))).toBe(true);
  });
});
