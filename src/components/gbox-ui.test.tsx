import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApprovalPanel } from "@/components/approval-panel";
import { ClaimLedger } from "@/components/claim-ledger";
import { StatusBoard } from "@/components/status-board";
import { TaskComposer } from "@/components/task-composer";
import { emptySnapshot, type Claim } from "@/types/gbox";

const gboxMock = vi.hoisted(() => ({
  resolveAction: vi.fn().mockResolvedValue(undefined),
  snapshot: {
    status: {},
    claims: [
      {
        id: "claim-1",
        sessionId: "replay",
        statement: "Contradicted test claim",
        claimType: "quantity",
        subject: "acme",
        predicate: "revenue",
        object: "revenue",
        temporalContext: "2026-Q2",
        assertedValue: "42",
        unit: "USD",
        sourceSpan: "42 USD",
        state: "Contradicted",
        confidence: 1,
        createdAt: "2026-07-19T12:00:00Z",
      },
    ],
    evidence: [],
    decisions: [],
    receipts: [],
    events: [],
    actions: [
      {
        id: "01f17438-f7d0-4db9-80e4-e23e59b10bea",
        sessionId: "replay",
        actionType: "test_webhook",
        reportMarkdown: "A governed report preview",
        payloadHash: "abc",
        state: "Pending",
        claimIds: ["claim-1"],
        requestedAt: "2026-07-19T12:00:00Z",
      },
    ],
  },
}));

vi.mock("@/hooks/use-gbox", () => ({
  useGbox: () => ({
    snapshot: gboxMock.snapshot,
    busy: false,
    error: undefined,
    resolveAction: gboxMock.resolveAction,
  }),
}));

function claim(id: string, state: Claim["state"]): Claim {
  return {
    id,
    sessionId: "replay",
    statement: `${state} test claim`,
    claimType: "quantity",
    subject: "acme",
    predicate: "revenue",
    object: "revenue",
    temporalContext: "2026-Q2",
    assertedValue: "42",
    unit: "USD",
    sourceSpan: "42 USD",
    state,
    confidence: 1,
    createdAt: "2026-07-19T12:00:00Z",
  };
}

describe("gBox interface", () => {
  it("filters the claim ledger by verdict", () => {
    render(
      <ClaimLedger
        claims={[
          claim("verified", "Verified"),
          claim("contradicted", "Contradicted"),
          claim("unknown", "Unverifiable"),
        ]}
        evidence={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Contradicted" }));
    expect(screen.getByText("Contradicted test claim")).toBeInTheDocument();
    expect(screen.queryByText("Verified test claim")).not.toBeInTheDocument();
  });

  it("exposes the global observation consent control", () => {
    const onChange = vi.fn();
    render(<StatusBoard status={emptySnapshot.status} onObservationChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "Global Codex observation" }));
    expect(onChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it("starts deterministic replay from the composer", () => {
    const replay = vi.fn();
    render(
      <TaskComposer
        busy={false}
        onStartLive={vi.fn()}
        onContinue={vi.fn()}
        onReplay={replay}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /run deterministic replay/i }));
    expect(replay).toHaveBeenCalledOnce();
  });

  it("shows risk and resolves the real pending approval", () => {
    const view = render(<ApprovalPanel />);
    expect(screen.getByText("High risk · contradicted")).toBeInTheDocument();
    expect(screen.getByText("A governed report preview")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /approve once/i }));
    expect(gboxMock.resolveAction).toHaveBeenCalledWith(
      "01f17438-f7d0-4db9-80e4-e23e59b10bea",
      "approve",
    );
    expect(screen.getByRole("button", { name: /approve once/i })).toBeDisabled();
    gboxMock.snapshot.actions[0].id = "54e8cadf-c443-4b36-b11b-b84b6ea67532";
    view.rerender(<ApprovalPanel />);
    expect(screen.getByRole("button", { name: /approve once/i })).toBeEnabled();
  });
});
