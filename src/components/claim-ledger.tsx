import { useMemo, useState } from "react";
import { CheckIcon, CircleHelpIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Claim, ClaimState, Evidence } from "@/types/gbox";

type Props = { claims: Claim[]; evidence: Evidence[] };
type Filter = "All" | ClaimState;

const filters: Filter[] = ["All", "Verified", "Contradicted", "Unverifiable"];

export function ClaimLedger({ claims, evidence }: Props) {
  const [filter, setFilter] = useState<Filter>("All");
  const visible = useMemo(
    () => claims.filter((claim) => filter === "All" || claim.state === filter),
    [claims, filter],
  );

  return (
    <div className="panel-surface">
      <div className="panel-toolbar">
        <div>
          <p className="eyebrow">Evidence ledger</p>
          <h2 className="panel-title">Claims</h2>
        </div>
        <div className="flex flex-wrap gap-1" aria-label="Claim state filters">
          {filters.map((item) => (
            <Button key={item} size="sm" variant={filter === item ? "secondary" : "ghost"} onClick={() => setFilter(item)}>
              {item}
            </Button>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        <Empty className="min-h-72">
          <EmptyHeader>
            <EmptyMedia variant="icon"><CircleHelpIcon /></EmptyMedia>
            <EmptyTitle>No claims in this view</EmptyTitle>
            <EmptyDescription>Run the replay or a live task to populate the evidence ledger.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea className="h-[390px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Verdict</TableHead>
                <TableHead>Claim</TableHead>
                <TableHead>Asserted</TableHead>
                <TableHead>Authoritative</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((claim) => {
                const proof = evidence.find((item) => item.claimId === claim.id);
                return (
                  <TableRow key={claim.id}>
                    <TableCell><VerdictBadge state={claim.state} /></TableCell>
                    <TableCell className="max-w-md">
                      <p className="font-medium leading-snug">{claim.statement}</p>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                        {claim.subject ?? "?"} / {claim.predicate ?? "?"} / {claim.temporalContext ?? "timeless"}
                      </p>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{claim.assertedValue ?? "—"} {claim.unit ?? ""}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {proof ? summarizeEvidence(proof) : "No evidence"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ScrollArea>
      )}
    </div>
  );
}

function summarizeEvidence(evidence: Evidence): string {
  const content = evidence.content;
  if (content && typeof content === "object") {
    const envelope = content as Record<string, unknown>;
    const toolResult = envelope.toolResult && typeof envelope.toolResult === "object"
      ? envelope.toolResult as Record<string, unknown>
      : envelope;
    const record = "record" in toolResult && toolResult.record && typeof toolResult.record === "object"
      ? toolResult.record as Record<string, unknown>
      : toolResult;
    if (typeof record.value === "string") {
      return `${record.value}${typeof record.unit === "string" ? ` ${record.unit}` : ""}`;
    }
  }
  return evidence.sourceName;
}

export function VerdictBadge({ state }: { state: ClaimState }) {
  const config = {
    Verified: { icon: CheckIcon, className: "verdict verdict--verified" },
    Contradicted: { icon: XIcon, className: "verdict verdict--contradicted" },
    Unverifiable: { icon: CircleHelpIcon, className: "verdict verdict--unverifiable" },
  }[state];
  const Icon = config.icon;
  return <Badge variant="outline" className={config.className}><Icon />{state}</Badge>;
}
