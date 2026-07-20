import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppHeader } from "@/components/app-header";
import { ApprovalDialog } from "@/components/approval-dialog";
import { ClaimDetail } from "@/components/claim-detail";
import { ClaimLedger } from "@/components/claim-ledger";
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
    expect(screen.getByRole("heading", { name: "Extracted structure" })).toBeInTheDocument();
    expect(screen.getByText("This is the narrow authoritative source.")).toBeInTheDocument();
    expect(screen.getAllByText("Deterministic adapter")).not.toHaveLength(0);
    expect(screen.getByText("An earlier source attempt timed out.")).toBeInTheDocument();
    expect(screen.getByText("Raw stored evidence")).toBeInTheDocument();
    expect(screen.getByText("2 read-only sources were eligible.")).toBeInTheDocument();
    expect(screen.getByText("Inspect 1 other eligible source")).toBeInTheDocument();
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
    expect(screen.queryByRole("heading", { name: "Extracted structure" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Verified test claim/ }));
    expect(onSelect).toHaveBeenCalledWith(selected);
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

  it("saves Codex inheritance and gBox-specific MCP settings", () => {
    const save = vi.fn();
    render(
      <EvidenceSettingsPanel
        busy={false}
        settings={emptySnapshot.evidenceSettings}
        sources={[]}
        onSave={save}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Use existing Codex MCP configuration" }));
    fireEvent.change(screen.getByLabelText("gBox-specific MCP servers (JSON)"), {
      target: {
        value: JSON.stringify([
          { name: "facts", enabled: true, transport: "stdio", command: "facts-mcp", args: [], envVars: [] },
        ]),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /save and discover/i }));
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
        onSaveEvidence={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Global Codex observation" })).toBeInTheDocument();
    expect(screen.getAllByText("Evidence sources")).not.toHaveLength(0);
  });

  it("navigates between the dashboard and settings screens", () => {
    const navigate = vi.fn();
    render(<AppHeader screen="dashboard" status={emptySnapshot.status} onNavigate={navigate} />);
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
