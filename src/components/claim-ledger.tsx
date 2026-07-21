import { useMemo, useState } from "react";
import { CheckIcon, CircleHelpIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Claim, ClaimState, Evidence } from "@/types/gbox";

type Props = {
  claims: Claim[];
  evidence: Evidence[];
  onSelectClaim?: (claim: Claim) => void;
};
type Filter = "All" | ClaimState;

const filters: Filter[] = ["All", "Verified", "Contradicted", "Unverifiable"];

export function ClaimLedger({ claims, evidence, onSelectClaim }: Props) {
  const [filter, setFilter] = useState<Filter>("All");
  const visible = useMemo(
    () => claims.filter((claim) => filter === "All" || claim.state === filter),
    [claims, filter],
  );

  return (
    <div className="panel-surface claim-index">
        <div className="panel-toolbar">
          <div>
            <p className="eyebrow">Research review</p>
            <h2 className="panel-title">All claims</h2>
          </div>
          <ToggleGroup
            value={[filter]}
            onValueChange={(value) => setFilter((value[0] as Filter | undefined) ?? "All")}
            variant="outline"
            size="sm"
            aria-label="Claim state filters"
          >
            {filters.map((item) => (
              <ToggleGroupItem key={item} value={item} aria-label={item}>
                {item}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {visible.length === 0 ? (
          <Empty className="min-h-72">
            <EmptyHeader>
              <EmptyMedia variant="icon"><CircleHelpIcon /></EmptyMedia>
              <EmptyTitle>No claims in this view</EmptyTitle>
              <EmptyDescription>Run the guided demo or complete research in Codex to see reviewed claims.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ScrollArea className="h-[min(620px,62svh)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Verdict</TableHead>
                  <TableHead>Claim</TableHead>
                  <TableHead>Evidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((claim) => {
                  const proof = evidence.find((item) => item.claimId === claim.id);
                  return (
                    <TableRow key={claim.id}>
                      <TableCell><VerdictBadge state={claim.state} /></TableCell>
                      <TableCell className="max-w-md">
                        <button className="claim-select" onClick={() => onSelectClaim?.(claim)}>
                          <span>{claim.statement}</span>
                          <small>{claim.subject ?? "?"} / {claim.predicate ?? "?"} / {claim.temporalContext ?? "timeless"}</small>
                        </button>
                      </TableCell>
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
