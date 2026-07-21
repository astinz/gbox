import { GboxOrb } from "@/components/gbox-orb";
import { VerdictBadge } from "@/components/claim-ledger";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { orbForDashboard } from "@/lib/orb-state";
import type { Claim, DashboardSnapshot, Observation } from "@/types/gbox";

export type DashboardDetail = "claims" | "actions" | "tools";

type Props = {
  snapshot: DashboardSnapshot;
  onOpenDetail: (detail: DashboardDetail) => void;
  onOpenClaim: (claim: Claim) => void;
  onRetryObservation: (observationId: string) => void;
};

export function DashboardOverview({
  snapshot,
  onOpenDetail,
  onOpenClaim,
  onRetryObservation,
}: Props) {
  const recent = snapshot.recentObservations.slice(0, 5);
  const posture = observationPosture(snapshot);
  const orb = orbForDashboard(snapshot);

  return (
    <section className="dashboard-overview" aria-label="Claim verification overview">
      <Card className="observation-card">
        <CardHeader className="observation-card__header">
          <div className="observation-card__identity">
            <span className="observation-card__orb">
              <GboxOrb {...orb} size={64} />
            </span>
            <div>
              <p className="eyebrow">Claim monitoring</p>
              <h2 className="observation-status">{posture.label}</h2>
              <p className="observation-status__detail">{posture.detail}</p>
            </div>
          </div>
          <div className="queue-count" aria-label={`${snapshot.observationQueueDepth} checks waiting`}>
            <strong>{snapshot.observationQueueDepth}</strong>
            <span>waiting</span>
          </div>
        </CardHeader>
        <CardContent className="observation-results">
          <div className="observation-results__heading">
            <span>Recent results</span>
            {!snapshot.status.notificationsAvailable && snapshot.status.globalObservation ? (
              <Badge variant="outline">In-app delivery</Badge>
            ) : null}
          </div>
          {recent.length ? (
            <div className="observation-list">
              {recent.map((observation) => {
                const claim = primaryClaim(observation, snapshot.claims);
                return (
                  <button
                    key={observation.id}
                    className="observation-row"
                    disabled={!claim && observation.state !== "Failed"}
                    onClick={() => {
                      if (claim) onOpenClaim(claim);
                      else if (observation.state === "Failed") onRetryObservation(observation.id);
                    }}
                  >
                    <span className="observation-row__verdict">
                      {claim ? <VerdictBadge state={claim.state} /> : observationBadge(observation)}
                    </span>
                    <span className="observation-row__copy">
                      <strong>{claim?.statement ?? observation.messageExcerpt}</strong>
                      <small>
                        {resultSummary(observation)}
                        {observation.state === "Failed" ? " · Select to retry" : ""}
                      </small>
                    </span>
                    <time>{formatRelativeTime(observation.completedAt ?? observation.createdAt)}</time>
                  </button>
                );
              })}
            </div>
          ) : (
            <Empty className="min-h-48 border-t">
              <EmptyHeader>
                <EmptyTitle>No claims reviewed yet</EmptyTitle>
                <EmptyDescription>
                  Turn on claim monitoring, then complete a response in Codex.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
        <CardFooter className="observation-card__actions">
          <Button variant="outline" size="sm" onClick={() => onOpenDetail("claims")}>All claims</Button>
          <Button variant="outline" size="sm" onClick={() => onOpenDetail("actions")}>Decisions</Button>
          <Button variant="ghost" size="sm" onClick={() => onOpenDetail("tools")}>Guided demo</Button>
        </CardFooter>
      </Card>
    </section>
  );
}

function observationPosture(snapshot: DashboardSnapshot): { label: string; detail: string } {
  if (!snapshot.status.globalObservation) {
    return { label: "Monitoring off", detail: "Turn on claim monitoring in Settings when you are ready." };
  }
  if (!snapshot.status.observationWorkerHealthy) {
    return { label: "Needs attention", detail: "Background checks are temporarily unavailable." };
  }
  if (snapshot.observationQueueDepth > 0) {
    return { label: "Checking claims", detail: "gBox is comparing new claims with available evidence." };
  }
  const latest = snapshot.recentObservations[0];
  if (latest && (latest.verdictCounts.contradicted > 0 || latest.verdictCounts.unverifiable > 0)) {
    return { label: "Needs attention", detail: "The latest response contains a conflict or an unresolved claim." };
  }
  return { label: "Ready", detail: "gBox is ready to check your next completed response." };
}

function primaryClaim(observation: Observation, claims: Claim[]): Claim | undefined {
  return claims.find((claim) => claim.id === observation.primaryClaimId);
}

function observationBadge(observation: Observation) {
  if (observation.state === "Failed") return <Badge variant="destructive">Failed</Badge>;
  if (observation.state === "Processing") return <Badge variant="secondary">Processing</Badge>;
  return <Badge variant="outline">No material claim</Badge>;
}

function resultSummary(observation: Observation): string {
  if (observation.failure) return observation.failure;
  const counts = observation.verdictCounts;
  return `${counts.contradicted} contradicted · ${counts.unverifiable} review · ${counts.verified} verified`;
}

function formatRelativeTime(value: string): string {
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (elapsedMinutes < 1) return "now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;
  return `${Math.round(elapsedHours / 24)}d`;
}
