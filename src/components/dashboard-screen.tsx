import { useEffect, useMemo, useState } from "react";

import { ActionHistory } from "@/components/action-history";
import { AppDialog } from "@/components/app-dialog";
import { ClaimDetail } from "@/components/claim-detail";
import { ClaimLedger } from "@/components/claim-ledger";
import { DashboardOverview, type DashboardDetail } from "@/components/dashboard-overview";
import { EventTimeline } from "@/components/event-timeline";
import { TaskComposer } from "@/components/task-composer";
import type { LiveActivitySource } from "@/lib/live-activity";
import type { Claim, CodexEvent, DashboardSnapshot } from "@/types/gbox";

type OpenView = { kind: DashboardDetail } | { kind: "claim"; claimId: string };

type Props = {
  snapshot: DashboardSnapshot;
  busy: boolean;
  sessionId?: string;
  activityStartedAt?: string;
  activitySource?: LiveActivitySource;
  activityEvents?: CodexEvent[];
  notificationClaimId?: string;
  onNotificationOpened: () => void;
  onStartLive: (cwd: string, prompt: string) => void;
  onContinue: (prompt: string) => void;
  onReplay: () => void;
  onRetryObservation: (observationId: string) => void;
};

export function DashboardScreen({
  snapshot,
  busy,
  sessionId,
  activityStartedAt,
  activitySource,
  activityEvents,
  notificationClaimId,
  onNotificationOpened,
  onStartLive,
  onContinue,
  onReplay,
  onRetryObservation,
}: Props) {
  const [openView, setOpenView] = useState<OpenView>();
  const selectedClaim = useMemo(
    () => openView?.kind === "claim"
      ? snapshot.claims.find((claim) => claim.id === openView.claimId)
      : undefined,
    [openView, snapshot.claims],
  );

  useEffect(() => {
    if (!notificationClaimId) return;
    setOpenView({ kind: "claim", claimId: notificationClaimId });
    onNotificationOpened();
  }, [notificationClaimId, onNotificationOpened]);

  function openClaim(claim: Claim) {
    setOpenView({ kind: "claim", claimId: claim.id });
  }

  return (
    <>
      <section className="page-intro">
        <div>
          <p className="eyebrow">Local evidence control</p>
          <h1>Research, with a second set of eyes.</h1>
        </div>
        <p>gBox checks material claims after each completed Codex turn and brings exceptions forward.</p>
      </section>

      <DashboardOverview
        snapshot={snapshot}
        onOpenDetail={(kind) => setOpenView({ kind })}
        onOpenClaim={openClaim}
        onRetryObservation={onRetryObservation}
      />

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
        {openView?.kind === "tools" ? (
          <TaskComposer
            busy={busy}
            sessionId={sessionId}
            events={activityEvents ?? snapshot.events}
            activityStartedAt={activityStartedAt}
            activitySource={activitySource}
            onStartLive={onStartLive}
            onContinue={onContinue}
            onReplay={onReplay}
          />
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
  if (view?.kind === "tools") return "Hosted and replay test tools";
  if (view?.kind === "claim") return "Verification dossier";
  return "gBox details";
}

function dialogDescription(view?: OpenView, claim?: Claim): string {
  if (view?.kind === "claims") return "Filter every extracted claim and open its verification record.";
  if (view?.kind === "events") return "Raw hosted and replay event telemetry, ordered by arrival.";
  if (view?.kind === "actions") return "Protected side effects and their tamper-evident decision receipts.";
  if (view?.kind === "tools") return "Run the deterministic judge path or a gBox-hosted Codex session.";
  if (view?.kind === "claim") return claim?.statement ?? "Full extraction and verification trace.";
  return "Detailed audit information.";
}
