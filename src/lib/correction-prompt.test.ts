import { describe, expect, it } from "vitest";

import { buildCorrectionPrompt } from "@/lib/correction-prompt";
import type { Claim, Evidence } from "@/types/gbox";

describe("Codex correction prompt", () => {
  it("contains the claim, conflicting evidence, source, and comparison method", () => {
    const prompt = buildCorrectionPrompt(claim, [evidence]);

    expect(prompt).toContain("Acme had 42 production database users");
    expect(prompt).toContain("authoritative value is 17");
    expect(prompt).toContain("company_data/company_get_metric");
    expect(prompt).toContain("deterministic adapter");
    expect(prompt).toContain("correct your prior answer");
  });
});

const claim: Claim = {
  id: "claim-1",
  sessionId: "session-1",
  statement: "Acme had 42 production database users in 2026-Q2.",
  claimType: "quantity",
  sourceSpan: "42 production database users",
  state: "Contradicted",
  confidence: 1,
  createdAt: "2026-07-21T00:00:00.000Z",
};

const evidence: Evidence = {
  id: "evidence-1",
  claimId: "claim-1",
  sourceKind: "plugin_mcp",
  sourceName: "company_data/company_get_metric",
  sourceReference: "mcpServer/tool/call:call-1",
  content: { value: "17", unit: "count" },
  resultHash: "hash",
  explanation: "The authoritative value is 17, not 42.",
  eligibleSources: [],
  comparisonMethod: "deterministic_adapter",
  createdAt: "2026-07-21T00:00:01.000Z",
};
