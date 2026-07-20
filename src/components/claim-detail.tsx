import {
  ArrowRightIcon,
  BracesIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  Globe2Icon,
  RouteIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Claim, Evidence, VerificationFailure } from "@/types/gbox";

type Props = {
  claim: Claim;
  evidence: Evidence[];
  failures: VerificationFailure[];
};

const methodLabels = {
  deterministic_adapter: "Deterministic adapter",
  model_assisted_mcp: "Model-assisted MCP",
  model_assisted_web: "Model-assisted web",
  no_comparison: "No comparison",
} as const;

export function ClaimDetail({ claim, evidence, failures }: Props) {
  const latest = evidence[0];
  const plan = latest?.selectedPlan;
  const eligibleSources = latest?.eligibleSources ?? [];
  const selectedSources = eligibleSources.filter((source) => planMatches(source, plan));
  const otherSources = eligibleSources.filter((source) => !planMatches(source, plan));

  return (
    <aside className="claim-dossier" aria-label={`Verification detail for ${claim.statement}`}>
      <div className="claim-dossier__header">
        <div>
          <p className="eyebrow">Verification dossier</p>
          <p className="claim-dossier__id">{claim.id.slice(0, 12)}</p>
        </div>
        {latest && (
          <Badge variant="outline" className="font-mono text-[10px]">
            {methodLabels[latest.comparisonMethod]}
          </Badge>
        )}
      </div>

      <ScrollArea className="h-[620px]">
        <div className="claim-dossier__body">
          <section className="dossier-section">
            <SectionHeading icon={BracesIcon} label="Extracted structure" />
            <p className="dossier-statement">{claim.statement}</p>
            <dl className="claim-fields">
              <ClaimField label="Type" value={claim.claimType} />
              <ClaimField label="Subject" value={claim.subject} />
              <ClaimField label="Predicate" value={claim.predicate} />
              <ClaimField label="Object" value={claim.object} />
              <ClaimField label="Value" value={joinValue(claim.assertedValue, claim.unit)} />
              <ClaimField label="When" value={claim.temporalContext} />
              <ClaimField label="Where" value={claim.location} />
              <ClaimField label="Verdict confidence" value={`${Math.round(claim.confidence * 100)}%`} />
            </dl>
            <div className="source-span">
              <span>Exact source span</span>
              <q>{claim.sourceSpan}</q>
            </div>
          </section>

          <section className="dossier-section">
            <SectionHeading icon={RouteIcon} label="Selected route" />
            {plan ? (
              <>
                <div className="route-line">
                  <span className="route-node">Claim</span>
                  <ArrowRightIcon />
                  <span className="route-node route-node--selected">{planLabel(plan)}</span>
                  <ArrowRightIcon />
                  <span className="route-node">Verdict</span>
                </div>
                <p className="route-rationale">{plan.rationale}</p>
                {(plan.arguments || plan.query) && (
                  <CodeDisclosure
                    label={plan.arguments ? "Planned arguments" : "Search query"}
                    value={plan.arguments ?? plan.query}
                  />
                )}
              </>
            ) : (
              <EmptyDetail>No source plan was stored for this evidence.</EmptyDetail>
            )}
          </section>

          <section className="dossier-section">
            <SectionHeading icon={DatabaseIcon} label="Eligible at decision time" />
            {eligibleSources.length ? (
              <div className="source-catalog">
                <p className="source-catalog__count">
                  {eligibleSources.length} read-only {eligibleSources.length === 1 ? "source was" : "sources were"} eligible.
                </p>
                {selectedSources.map((source) => (
                  <SourceCatalogItem key={sourceKey(source)} source={source} selected />
                ))}
                {otherSources.length > 0 && (
                  <details className="source-catalog__more">
                    <summary>
                      Inspect {otherSources.length} other eligible {otherSources.length === 1 ? "source" : "sources"}
                    </summary>
                    <div className="source-catalog__list">
                      {otherSources.map((source) => (
                        <SourceCatalogItem key={sourceKey(source)} source={source} selected={false} />
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ) : (
              <EmptyDetail>No source-catalog snapshot is available.</EmptyDetail>
            )}
          </section>

          <section className="dossier-section">
            <SectionHeading icon={CheckCircle2Icon} label="Evidence and comparison" />
            {latest ? (
              <>
                <div className="evidence-summary">
                  <span>{latest.sourceName}</span>
                  <p>{latest.explanation}</p>
                </div>
                <dl className="evidence-metadata">
                  <ClaimField label="Method" value={methodLabels[latest.comparisonMethod]} />
                  <ClaimField label="Reference" value={latest.sourceReference} />
                  <ClaimField label="SHA-256" value={latest.resultHash} />
                </dl>
                <CodeDisclosure label={evidencePayloadLabel(latest)} value={latest.content ?? null} />
              </>
            ) : (
              <EmptyDetail>No evidence has been stored for this claim.</EmptyDetail>
            )}
          </section>

          <section className="dossier-section">
            <SectionHeading icon={TriangleAlertIcon} label="Failure history" />
            {failures.length ? (
              <ol className="failure-history">
                {failures.map((failure) => (
                  <li key={failure.id}>
                    <span className="failure-history__node" />
                    <div>
                      <p><strong>{failure.stage}</strong><time>{formatTime(failure.createdAt)}</time></p>
                      <span>{failure.message}</span>
                      {failure.details != null
                        ? <CodeDisclosure label="Failure details" value={failure.details} />
                        : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="failure-clear"><CheckCircle2Icon />No verification failures recorded.</p>
            )}
          </section>
        </div>
      </ScrollArea>
    </aside>
  );
}

function SectionHeading({ icon: Icon, label }: { icon: typeof RouteIcon; label: string }) {
  return <h3 className="dossier-heading"><Icon />{label}</h3>;
}

function ClaimField({ label, value }: { label: string; value?: string }) {
  return <div><dt>{label}</dt><dd title={value}>{value || "—"}</dd></div>;
}

function EmptyDetail({ children }: { children: React.ReactNode }) {
  return <p className="dossier-empty">{children}</p>;
}

function CodeDisclosure({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="code-disclosure">
      <summary>{label}</summary>
      <pre>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

function joinValue(value?: string, unit?: string): string | undefined {
  return value ? `${value}${unit ? ` ${unit}` : ""}` : undefined;
}

function planLabel(plan: NonNullable<Evidence["selectedPlan"]>): string {
  if (plan.sourceType === "mcp") return `${plan.server ?? "MCP"}/${plan.tool ?? "tool"}`;
  if (plan.sourceType === "web_search") return "Web search";
  return "No source";
}

function sourceKey(source: Evidence["eligibleSources"][number]): string {
  return `${source.sourceKind}:${source.server ?? "built-in"}:${source.tool ?? source.title}`;
}

function SourceCatalogItem({
  source,
  selected,
}: {
  source: Evidence["eligibleSources"][number];
  selected: boolean;
}) {
  return (
    <div className="source-catalog__item">
      {source.sourceKind === "web_search" ? <Globe2Icon /> : <DatabaseIcon />}
      <div>
        <p>{source.tool ?? source.title}</p>
        <span>
          {source.server ?? "built-in"} · {source.pluginBacked ? "plugin MCP" : source.sourceKind}
        </span>
      </div>
      {selected && <Badge variant="secondary">selected</Badge>}
    </div>
  );
}

function evidencePayloadLabel(evidence: Evidence): string {
  return evidence.comparisonMethod === "model_assisted_web"
    ? "Stored verifier output (not a page snapshot)"
    : "Raw stored evidence";
}

function planMatches(
  source: Evidence["eligibleSources"][number],
  plan?: Evidence["selectedPlan"],
): boolean {
  if (!plan) return false;
  if (plan.sourceType === "web_search") return source.sourceKind === "web_search";
  return source.server === plan.server && source.tool === plan.tool;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
