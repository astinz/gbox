import { useMemo, useState } from "react";

import { ActionHistory } from "@/components/action-history";
import { AppDialog } from "@/components/app-dialog";
import { ClaimDetail } from "@/components/claim-detail";
import { ClaimLedger } from "@/components/claim-ledger";
import { DashboardOverview, type DashboardDetail } from "@/components/dashboard-overview";
import { EventTimeline } from "@/components/event-timeline";
import { TaskComposer } from "@/components/task-composer";
import type { Claim, DashboardSnapshot } from "@/types/gbox";

type OpenView = { kind: DashboardDetail } | { kind: "claim"; claimId: string };

type Props = {
  snapshot: DashboardSnapshot;
  busy: boolean;
  sessionId?: string;
  onStartLive: (cwd: string, prompt: string) => void;
  onContinue: (prompt: string) => void;
  onReplay: () => void;
};

export function DashboardScreen({
  snapshot,
  busy,
  sessionId,
  onStartLive,
  onContinue,
  onReplay,
}: Props) {
  const [openView, setOpenView] = useState<OpenView>();
  const selectedClaim = useMemo(
    () => openView?.kind === "claim"
      ? snapshot.claims.find((claim) => claim.id === openView.claimId)
      : undefined,
    [openView, snapshot.claims],
  );

  function openClaim(claim: Claim) {
    setOpenView({ kind: "claim", claimId: claim.id });
  }

  return (
    <>
      <section className="page-intro">
        <div>
          <p className="eyebrow">Local evidence control</p>
          <h1>Govern the claims that drive action.</h1>
        </div>
        <p>Run a task, inspect the posture, and open the audit trail only when you need it.</p>
      </section>

      <div className="dashboard-grid">
        <TaskComposer
          busy={busy}
          sessionId={sessionId}
          onStartLive={onStartLive}
          onContinue={onContinue}
          onReplay={onReplay}
        />
        <DashboardOverview
          snapshot={snapshot}
          onOpenDetail={(kind) => setOpenView({ kind })}
          onOpenClaim={openClaim}
        />
      </div>

      <AppDialog
        open={Boolean(openView)}
        onOpenChange={(open) => { if (!open) setOpenView(undefined); }}
        title={dialogTitle(openView)}
        description={dialogDescription(openView, selectedClaim)}
      >
        {openView?.kind === "claims" ? (
          <ClaimLedger
            claims={snapshot.claims}
            evidence={snapshot.evidence}
            onSelectClaim={openClaim}
          />
        ) : null}
        {openView?.kind === "events" ? <EventTimeline events={snapshot.events} /> : null}
        {openView?.kind === "actions" ? (
          <ActionHistory actions={snapshot.actions} receipts={snapshot.receipts} />
        ) : null}
        {openView?.kind === "claim" && selectedClaim ? (
          <ClaimDetail
            claim={selectedClaim}
            evidence={snapshot.evidence.filter((item) => item.claimId === selectedClaim.id)}
            failures={snapshot.verificationFailures.filter((item) => item.claimId === selectedClaim.id)}
          />
        ) : null}
      </AppDialog>
    </>
  );
}

function dialogTitle(view?: OpenView): string {
  if (view?.kind === "claims") return "Claim ledger";
  if (view?.kind === "events") return "Codex App Server events";
  if (view?.kind === "actions") return "Actions and receipt chain";
  if (view?.kind === "claim") return "Verification dossier";
  return "gBox details";
}

function dialogDescription(view?: OpenView, claim?: Claim): string {
  if (view?.kind === "claims") return "Filter every extracted claim and open its verification record.";
  if (view?.kind === "events") return "Raw hosted and replay event telemetry, ordered by arrival.";
  if (view?.kind === "actions") return "Protected side effects and their tamper-evident decision receipts.";
  if (view?.kind === "claim") return claim?.statement ?? "Full extraction and verification trace.";
  return "Detailed audit information.";
}
