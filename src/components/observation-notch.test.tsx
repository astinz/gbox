import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ObservationNotch } from "@/components/observation-notch";
import type { Observation } from "@/types/gbox";

const contradicted: Observation = {
  id: "observation",
  sessionId: "codex-session",
  source: "codex-stop-hook",
  messageHash: "hash",
  messageExcerpt: "Acme had 42 production database users in 2026-Q2.",
  state: "Completed",
  attempts: 1,
  primaryClaimId: "claim",
  verdictCounts: { verified: 0, contradicted: 1, unverifiable: 0 },
  notificationState: "Pending",
  createdAt: "2026-07-21T00:00:00Z",
};

describe("ObservationNotch", () => {
  it("shows capture context and prioritized verdict in the expanded notch", () => {
    render(
      <ObservationNotch
        phase="completed"
        expanded
        observation={contradicted}
        queueDepth={0}
        onReview={vi.fn()}
      />,
    );

    expect(screen.getByText("Captured from Codex")).toBeInTheDocument();
    expect(screen.getAllByText("Contradicted")).toHaveLength(2);
    expect(screen.getByText(contradicted.messageExcerpt)).toBeInTheDocument();
  });

  it("opens gBox from the compact notch", () => {
    const review = vi.fn();
    render(
      <ObservationNotch
        phase="watching"
        expanded={false}
        queueDepth={0}
        onReview={review}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open gBox" }));
    expect(review).toHaveBeenCalledOnce();
  });

  it("labels a hover expansion as a preview of the latest result", () => {
    render(
      <ObservationNotch
        phase="watching"
        expanded
        previewingLatest
        observation={contradicted}
        queueDepth={0}
        onReview={vi.fn()}
      />,
    );

    expect(screen.getByText("Latest result")).toBeInTheDocument();
    expect(screen.getByText("Latest Codex observation")).toBeInTheDocument();
    expect(screen.getByText("Contradicted")).toBeInTheDocument();
  });
});
