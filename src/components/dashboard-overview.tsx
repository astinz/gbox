import {
  ActivityIcon,
  ArrowUpRightIcon,
  DatabaseZapIcon,
  FileCheck2Icon,
  ListChecksIcon,
  ShieldAlertIcon,
} from "lucide-react";

import { VerdictBadge } from "@/components/claim-ledger";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { Claim, DashboardSnapshot } from "@/types/gbox";

export type DashboardDetail = "claims" | "events" | "actions";

type Props = {
  snapshot: DashboardSnapshot;
  onOpenDetail: (detail: DashboardDetail) => void;
  onOpenClaim: (claim: Claim) => void;
};

export function DashboardOverview({ snapshot, onOpenDetail, onOpenClaim }: Props) {
  const recentClaims = snapshot.claims.slice(0, 3);
  const verified = snapshot.claims.filter((claim) => claim.state === "Verified").length;
  const pending = snapshot.actions.filter((action) => action.state === "Pending").length;

  return (
    <section className="dashboard-overview" aria-label="gBox overview">
      <Card className="overview-card">
        <CardHeader>
          <CardTitle>Control posture</CardTitle>
          <CardDescription>Only the signals needed to decide what deserves attention now.</CardDescription>
        </CardHeader>
        <CardContent className="metric-grid">
          <Metric icon={ListChecksIcon} label="Claims" value={snapshot.claims.length} detail={`${verified} verified`} />
          <Metric icon={ShieldAlertIcon} label="Waiting" value={pending} detail="human decisions" />
          <Metric icon={DatabaseZapIcon} label="Sources" value={snapshot.status.evidenceSourceCount} detail="eligible now" />
          <Metric icon={FileCheck2Icon} label="Receipts" value={snapshot.receipts.length} detail={snapshot.status.receiptChainValid ? "chain intact" : "chain broken"} />
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenDetail("events")}>
            <ActivityIcon data-icon="inline-start" /> Events <Badge variant="secondary">{snapshot.events.length}</Badge>
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpenDetail("actions")}>
            <FileCheck2Icon data-icon="inline-start" /> Actions & receipts
          </Button>
        </CardFooter>
      </Card>

      <Card className="recent-claims-card">
        <CardHeader>
          <CardTitle>Recent claims</CardTitle>
          <CardDescription>The latest verification outcomes.</CardDescription>
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => onOpenDetail("claims")}>
              View ledger <ArrowUpRightIcon data-icon="inline-end" />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {recentClaims.length ? (
            <div className="recent-claims">
              {recentClaims.map((claim) => (
                <button key={claim.id} className="recent-claim" onClick={() => onOpenClaim(claim)}>
                  <VerdictBadge state={claim.state} />
                  <span>{claim.statement}</span>
                  <ArrowUpRightIcon />
                </button>
              ))}
            </div>
          ) : (
            <Empty className="min-h-40">
              <EmptyHeader>
                <EmptyMedia variant="icon"><ListChecksIcon /></EmptyMedia>
                <EmptyTitle>No claims yet</EmptyTitle>
                <EmptyDescription>Start a task or replay to create the first evidence record.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof ListChecksIcon;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="metric">
      <Icon />
      <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
    </div>
  );
}
