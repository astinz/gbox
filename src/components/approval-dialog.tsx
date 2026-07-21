import { useEffect, useMemo, useState } from "react";
import { AlertTriangleIcon, CheckIcon, XIcon } from "lucide-react";

import { AppDialog } from "@/components/app-dialog";
import { VerdictBadge } from "@/components/claim-ledger";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import type { Claim, ClaimState, PendingAction } from "@/types/gbox";

type Props = {
  action?: PendingAction;
  claims: Claim[];
  busy: boolean;
  error?: string;
  onResolve: (actionId: string, decision: "approve" | "deny") => Promise<unknown>;
};

export function ApprovalDialog({ action, claims, busy, error, onResolve }: Props) {
  const [decisionSent, setDecisionSent] = useState(false);
  const linkedClaims = useMemo(
    () => claims.filter((claim) => action?.claimIds.includes(claim.id)),
    [action, claims],
  );
  const risk = riskFor(linkedClaims.map((claim) => claim.state));

  useEffect(() => {
    setDecisionSent(false);
  }, [action?.id]);

  async function decide(decision: "approve" | "deny") {
    if (!action) return;
    setDecisionSent(true);
    const result = await onResolve(action.id, decision);
    if (result === undefined) setDecisionSent(false);
  }

  return (
    <AppDialog
      open={Boolean(action)}
      onOpenChange={() => undefined}
      title="Allow this report to be sent?"
      description="gBox always asks before sending a report, regardless of the evidence result."
      width="compact"
      dismissible={false}
      bodyClassName="approval-dialog__body"
      footer={
        <>
          <Button variant="outline" size="lg" onClick={() => void decide("deny")} disabled={decisionSent || busy}>
            <XIcon data-icon="inline-start" /> Deny
          </Button>
          <Button size="lg" onClick={() => void decide("approve")} disabled={decisionSent || busy}>
            {busy ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
            Approve once
          </Button>
        </>
      }
    >
      {action ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <Badge variant={risk.variant}><AlertTriangleIcon />{risk.label}</Badge>
            <code className="text-[10px] text-muted-foreground">{action.id.slice(0, 8)}</code>
          </div>
          <section>
            <p className="eyebrow">Destination</p>
            <p className="mt-1 font-medium">gBox demo destination</p>
            <p className="text-xs text-muted-foreground">This demo cannot send anywhere else.</p>
          </section>
          <Separator />
          <section>
            <p className="eyebrow">Evidence status</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {linkedClaims.length
                ? linkedClaims.map((claim) => <VerdictBadge key={claim.id} state={claim.state} />)
                : <Badge variant="outline">No supporting claims found</Badge>}
            </div>
          </section>
          <section>
            <p className="eyebrow">What will be sent</p>
            <ScrollArea className="report-preview mt-2 h-52">
              <p className="whitespace-pre-wrap p-4 text-sm leading-relaxed">{action.reportMarkdown}</p>
            </ScrollArea>
          </section>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </AppDialog>
  );
}

function riskFor(states: ClaimState[]): {
  label: string;
  variant: "outline" | "destructive" | "secondary";
} {
  if (states.includes("Contradicted")) return { label: "High risk · contradicted", variant: "destructive" };
  if (states.includes("Unverifiable") || states.length === 0) {
    return { label: "Caution · unverifiable", variant: "secondary" };
  }
  return { label: "Low risk · verified", variant: "outline" };
}
