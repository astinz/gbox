import { useEffect, useMemo, useState } from "react";
import { AlertTriangleIcon, CheckIcon, ShieldCheckIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { useGbox } from "@/hooks/use-gbox";
import type { ClaimState } from "@/types/gbox";
import { VerdictBadge } from "./claim-ledger";

export function ApprovalPanel() {
  const gbox = useGbox();
  const action = gbox.snapshot.actions.find((item) => item.state === "Pending");
  const claims = useMemo(
    () => gbox.snapshot.claims.filter((claim) => action?.claimIds.includes(claim.id)),
    [action, gbox.snapshot.claims],
  );
  const [decisionSent, setDecisionSent] = useState(false);
  const risk = riskFor(claims.map((claim) => claim.state));

  useEffect(() => {
    setDecisionSent(false);
  }, [action?.id]);

  async function decide(decision: "approve" | "deny") {
    if (!action) return;
    setDecisionSent(true);
    await gbox.resolveAction(action.id, decision);
  }

  return (
    <main className="approval-shell">
      <div className="brand-lockup"><span className="brand-mark"><ShieldCheckIcon /></span><span>gBox</span><Badge variant="outline">human gate</Badge></div>
      {!action ? (
        <Card className="mt-6">
          <CardHeader><CardTitle>No pending approval</CardTitle><CardDescription>This window closes automatically when the action is resolved.</CardDescription></CardHeader>
        </Card>
      ) : (
        <Card className="approval-card mt-6">
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-2">
              <Badge className={risk.className} variant="outline"><AlertTriangleIcon />{risk.label}</Badge>
              <code className="text-[10px] text-muted-foreground">{action.id.slice(0, 8)}</code>
            </div>
            <CardTitle className="mt-3 text-2xl">Allow this webhook?</CardTitle>
            <CardDescription>Every protected delivery requires a decision, regardless of claim verdict.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <section>
              <p className="eyebrow">Fixed destination</p>
              <p className="mt-1 font-medium">Bundled loopback test sink</p>
              <p className="text-xs text-muted-foreground">No arbitrary URL is accepted.</p>
            </section>
            <Separator />
            <section>
              <p className="eyebrow">Linked evidence</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {claims.length ? claims.map((claim) => <VerdictBadge key={claim.id} state={claim.state} />) : <Badge variant="outline">No extracted claims</Badge>}
              </div>
            </section>
            <section>
              <p className="eyebrow">Report preview</p>
              <ScrollArea className="report-preview mt-2 h-52">
                <p className="whitespace-pre-wrap p-4 text-sm leading-relaxed">{action.reportMarkdown}</p>
              </ScrollArea>
            </section>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="lg" onClick={() => void decide("deny")} disabled={decisionSent || gbox.busy}><XIcon /> Deny</Button>
              <Button size="lg" className="approve-button" onClick={() => void decide("approve")} disabled={decisionSent || gbox.busy}>
                {gbox.busy ? <Spinner /> : <CheckIcon />} Approve once
              </Button>
            </div>
            {gbox.error && <p role="alert" className="text-sm text-destructive">{gbox.error}</p>}
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function riskFor(states: ClaimState[]) {
  if (states.includes("Contradicted")) return { label: "High risk · contradicted", className: "risk risk--high" };
  if (states.includes("Unverifiable") || states.length === 0) return { label: "Caution · unverifiable", className: "risk risk--caution" };
  return { label: "Low risk · verified", className: "risk risk--low" };
}
