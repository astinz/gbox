import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppHeader } from "@/components/app-header";
import { ApprovalDialog } from "@/components/approval-dialog";
import { ClaimDetail } from "@/components/claim-detail";
import { ClaimLedger } from "@/components/claim-ledger";
import { DashboardOverview } from "@/components/dashboard-overview";
import { EvidenceSettingsPanel } from "@/components/evidence-settings";
import { SettingsScreen } from "@/components/settings-screen";
import { StatusBoard } from "@/components/status-board";
import { TaskComposer } from "@/components/task-composer";
import { emptySnapshot, type Claim } from "@/types/gbox";

const gboxMock = vi.hoisted(() => ({
  resolveAction: vi.fn().mockResolvedValue({ action: { state: "Approved" } }),
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
        state: "Contradicted" as const,
        confidence: 1,
        createdAt: "2026-07-19T12:00:00Z",
      },
    ],
    evidence: [],
    decisions: [],
    receipts: [],
    events: [],
    evidenceSettings: {
      useCodexMcpConfig: true,
      webSearchMode: "cached",
      mcpServers: [],
    },
    evidenceSources: [],
    verificationFailures: [],
    actions: [
      {
        id: "01f17438-f7d0-4db9-80e4-e23e59b10bea",
        sessionId: "replay",
        actionType: "test_webhook",
        reportMarkdown: "A governed report preview",
        payloadHash: "abc",
        state: "Pending" as const,
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
    expect(screen.getByRole("button", { name: /Contradicted test claim/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Verified test claim/ })).not.toBeInTheDocument();
  });

  it("shows a durable verification dossier for the selected claim", () => {
    const selected = claim("claim-detail", "Contradicted");
    render(
      <ClaimDetail
        claim={selected}
        evidence={[{
          id: "evidence-1",
          claimId: selected.id,
          sourceKind: "plugin_mcp",
          sourceName: "company_data/company_get_metric",
          sourceReference: "mcpServer/tool/call:7",
          content: { toolResult: { value: "17", unit: "count" } },
          resultHash: "abc123",
          explanation: "The claim states 42, but the record contains 17.",
          eligibleSources: [{
            sourceKind: "plugin_mcp",
            server: "company_data",
            tool: "company_get_metric",
            title: "Company metric",
            description: "Read a metric",
            inputSchema: {},
            readOnly: true,
            pluginBacked: true,
          }, {
            sourceKind: "web_search",
            title: "Codex web search",
            description: "Search public sources",
            inputSchema: {},
            readOnly: true,
            pluginBacked: false,
          }],
          selectedPlan: {
            sourceType: "mcp",
            server: "company_data",
            tool: "company_get_metric",
            arguments: { company_id: "acme" },
            rationale: "This is the narrow authoritative source.",
          },
          comparisonMethod: "deterministic_adapter",
          createdAt: "2026-07-20T12:00:00Z",
        }]}
        failures={[{
          id: "failure-1",
          claimId: selected.id,
          stage: "source_call",
          message: "An earlier source attempt timed out.",
          createdAt: "2026-07-20T11:59:00Z",
        }]}
      />,
    );
    expect(screen.getByRole("heading", { name: "What gBox understood" })).toBeInTheDocument();
    expect(screen.getByText(/directly covers the subject, topic, and time period/i)).toBeInTheDocument();
    expect(screen.getAllByText("Exact source comparison")).not.toHaveLength(0);
    expect(screen.getByText("An earlier source attempt timed out.")).toBeInTheDocument();
    expect(screen.getByText("Original evidence record")).toBeInTheDocument();
    expect(screen.getByText("2 trusted sources were available.")).toBeInTheDocument();
    expect(screen.getByText("View 1 other source")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy correction for Codex" })).toBeInTheDocument();
  });

  it("makes ordinary Codex observation the primary dashboard signal", () => {
    const selected = claim("claim-observed", "Contradicted");
    const snapshot = {
      ...emptySnapshot,
      status: {
        ...emptySnapshot.status,
        globalObservation: true,
        observationWorkerHealthy: true,
      },
      claims: [selected],
      recentObservations: [{
        id: "observation-1",
        sessionId: "codex-session",
        source: "codex-stop-hook",
        messageHash: "hash",
        messageExcerpt: selected.statement,
        state: "Completed" as const,
        attempts: 1,
        primaryClaimId: selected.id,
        verdictCounts: { verified: 0, contradicted: 1, unverifiable: 0 },
        notificationState: "Failed" as const,
        createdAt: new Date().toISOString(),
      }],
    };
    const openClaim = vi.fn();
    render(
      <DashboardOverview
        snapshot={snapshot}
        onOpenDetail={vi.fn()}
        onOpenClaim={openClaim}
        onRetryObservation={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Needs attention" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Contradicted test claim/ }));
    expect(openClaim).toHaveBeenCalledWith(selected);
  });

  it("reveals claim details on demand from the ledger", () => {
    const selected = claim("claim-on-demand", "Verified");
    const onSelect = vi.fn();
    render(
      <ClaimLedger
        claims={[selected]}
        evidence={[]}
        onSelectClaim={onSelect}
      />,
    );
    expect(screen.queryByRole("heading", { name: "What gBox understood" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Verified test claim/ }));
    expect(onSelect).toHaveBeenCalledWith(selected);
  });

  it("exposes the global observation consent control", () => {
    const onChange = vi.fn();
    render(
      <StatusBoard
        status={emptySnapshot.status}
        onObservationChange={onChange}
        onLaunchAtLoginChange={vi.fn()}
        onNotchChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Monitor Codex research" }));
    expect(onChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it("keeps launch-at-login independent from observation", () => {
    const observe = vi.fn();
    const launch = vi.fn();
    render(
      <StatusBoard
        status={emptySnapshot.status}
        onObservationChange={observe}
        onLaunchAtLoginChange={launch}
        onNotchChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "Open gBox at login" }));
    expect(launch).toHaveBeenCalledWith(true, expect.anything());
    expect(observe).not.toHaveBeenCalled();
  });

  it("shows the observation notch setting only when macOS supports it", () => {
    const toggle = vi.fn();
    render(
      <StatusBoard
        status={{ ...emptySnapshot.status, notchAvailable: true, notchEnabled: true }}
        onObservationChange={vi.fn()}
        onLaunchAtLoginChange={vi.fn()}
        onNotchChange={toggle}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "Top-of-screen updates" }));
    expect(toggle).toHaveBeenCalledWith(false, expect.anything());
  });

  it("starts the guided demo from the composer", () => {
    const replay = vi.fn();
    render(
      <TaskComposer
        busy={false}
        onStartLive={vi.fn()}
        onContinue={vi.fn()}
        onReplay={replay}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /run guided demo/i }));
    expect(replay).toHaveBeenCalledOnce();
  });

  it("explains what is happening while a live turn connects", () => {
    render(
      <TaskComposer
        busy
        activityStartedAt="2026-07-20T10:00:00.000Z"
        onStartLive={vi.fn()}
        onContinue={vi.fn()}
        onReplay={vi.fn()}
      />,
    );
    expect(screen.getByRole("region", { name: "Research progress" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Connecting to Codex")).toBeInTheDocument();
    expect(screen.getByText(/Private reasoning is never displayed/)).toBeInTheDocument();
  });

  it("saves existing and additional evidence sources", () => {
    const save = vi.fn();
    render(
      <EvidenceSettingsPanel
        busy={false}
        settings={emptySnapshot.evidenceSettings}
        sources={[]}
        onSave={save}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Use sources already connected to Codex" }));
    fireEvent.click(screen.getByText("Managed source setup"));
    fireEvent.change(screen.getByLabelText("Additional source connections"), {
      target: {
        value: JSON.stringify([
          { name: "facts", enabled: true, transport: "stdio", command: "facts-mcp", args: [], envVars: [] },
        ]),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /save sources/i }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      useCodexMcpConfig: false,
      mcpServers: [expect.objectContaining({ name: "facts" })],
    }));
  });

  it("presents system-wide controls on a dedicated settings screen", () => {
    render(
      <SettingsScreen
        snapshot={emptySnapshot}
        busy={false}
        onObservationChange={vi.fn()}
        onLaunchAtLoginChange={vi.fn()}
        onNotchChange={vi.fn()}
        onSaveEvidence={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Monitor Codex research" })).toBeInTheDocument();
    expect(screen.getAllByText("Sources used for checks")).not.toHaveLength(0);
  });

  it("navigates between the dashboard and settings screens", () => {
    const navigate = vi.fn();
    render(<AppHeader screen="dashboard" onNavigate={navigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(navigate).toHaveBeenCalledWith("settings");
  });

  it("shows risk and resolves the real pending approval", () => {
    const view = render(
      <ApprovalDialog
        action={gboxMock.snapshot.actions[0]}
        claims={gboxMock.snapshot.claims}
        busy={false}
        onResolve={gboxMock.resolveAction}
      />,
    );
    expect(screen.getByText("High risk · contradicted")).toBeInTheDocument();
    expect(screen.getByText("A governed report preview")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /approve once/i }));
    expect(gboxMock.resolveAction).toHaveBeenCalledWith(
      "01f17438-f7d0-4db9-80e4-e23e59b10bea",
      "approve",
    );
    expect(screen.getByRole("button", { name: /approve once/i })).toBeDisabled();
    gboxMock.snapshot.actions[0].id = "54e8cadf-c443-4b36-b11b-b84b6ea67532";
    view.rerender(
      <ApprovalDialog
        action={gboxMock.snapshot.actions[0]}
        claims={gboxMock.snapshot.claims}
        busy={false}
        onResolve={gboxMock.resolveAction}
      />,
    );
    expect(screen.getByRole("button", { name: /approve once/i })).toBeEnabled();
  });
});
