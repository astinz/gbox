import {
  ArrowRightIcon,
  BracesIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  Globe2Icon,
  RouteIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildCorrectionPrompt } from "@/lib/correction-prompt";
import type { Claim, Evidence, VerificationFailure } from "@/types/gbox";

type Props = {
  claim: Claim;
  evidence: Evidence[];
  failures: VerificationFailure[];
};

const methodLabels = {
  deterministic_adapter: "Exact source comparison",
  model_assisted_mcp: "Connected-source comparison",
  model_assisted_web: "Public-source comparison",
  no_comparison: "No comparison available",
} as const;

export function ClaimDetail({ claim, evidence, failures }: Props) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const latest = evidence[0];
  const plan = latest?.selectedPlan;
  const eligibleSources = latest?.eligibleSources ?? [];
  const selectedSources = eligibleSources.filter((source) => planMatches(source, plan));
  const otherSources = eligibleSources.filter((source) => !planMatches(source, plan));

  return (
    <article className="claim-detail" aria-label={`Evidence review for ${claim.statement}`}>
      <div className="claim-detail__meta">
        <span className="eyebrow">Evidence review</span>
        <div className="flex items-center gap-2">
          {claim.state === "Contradicted" && latest ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void writeText(buildCorrectionPrompt(claim, evidence))
                  .then(() => setCopyState("copied"))
                  .catch(() => setCopyState("failed"));
              }}
            >
              {copyState === "copied"
                ? "Copied for Codex"
                : copyState === "failed"
                  ? "Copy failed"
                  : "Copy correction for Codex"}
            </Button>
          ) : null}
          {latest && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {methodLabels[latest.comparisonMethod]}
            </Badge>
          )}
        </div>
      </div>
      <div className="claim-dossier__body">
          <section className="dossier-section">
            <SectionHeading icon={BracesIcon} label="What gBox understood" />
            <p className="dossier-statement">{claim.statement}</p>
            <dl className="claim-fields">
              <ClaimField label="Category" value={friendlyName(claim.claimType)} />
              <ClaimField label="Subject" value={claim.subject} />
              <ClaimField label="Topic" value={claim.predicate ? friendlyName(claim.predicate) : undefined} />
              <ClaimField label="Description" value={claim.object} />
              <ClaimField label="Value" value={joinValue(claim.assertedValue, claim.unit)} />
              <ClaimField label="When" value={claim.temporalContext} />
              <ClaimField label="Where" value={claim.location} />
              <ClaimField label="Confidence" value={`${Math.round(claim.confidence * 100)}%`} />
            </dl>
            <div className="source-span">
              <span>Original wording</span>
              <q>{claim.sourceSpan}</q>
            </div>
          </section>

          <section className="dossier-section">
            <SectionHeading icon={RouteIcon} label="How this was checked" />
            {plan ? (
              <>
                <div className="route-line">
                  <span className="route-node">Statement</span>
                  <ArrowRightIcon />
                  <span className="route-node route-node--selected">{planLabel(plan)}</span>
                  <ArrowRightIcon />
                  <span className="route-node">Result</span>
                </div>
                <p className="route-rationale">{planRationale(plan)}</p>
                {(plan.arguments || plan.query) && (
                  <CodeDisclosure
                    label={plan.arguments ? "Lookup details" : "Search terms"}
                    value={plan.arguments ?? plan.query}
                  />
                )}
              </>
            ) : (
              <EmptyDetail>No checking approach was saved for this evidence.</EmptyDetail>
            )}
          </section>

          <section className="dossier-section">
            <SectionHeading icon={DatabaseIcon} label="Sources considered" />
            {eligibleSources.length ? (
              <div className="source-catalog">
                <p className="source-catalog__count">
                  {eligibleSources.length} trusted {eligibleSources.length === 1 ? "source was" : "sources were"} available.
                </p>
                {selectedSources.map((source) => (
                  <SourceCatalogItem key={sourceKey(source)} source={source} selected />
                ))}
                {otherSources.length > 0 && (
                  <details className="source-catalog__more">
                    <summary>
                      View {otherSources.length} other {otherSources.length === 1 ? "source" : "sources"}
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
              <EmptyDetail>No source list was saved for this check.</EmptyDetail>
            )}
          </section>

          <section className="dossier-section">
            <SectionHeading icon={CheckCircle2Icon} label="Evidence reviewed" />
            {latest ? (
              <>
                <div className="evidence-summary">
                  <span>{sourceDisplayName(latest.sourceName)}</span>
                  <p>{latest.explanation}</p>
                </div>
                <dl className="evidence-metadata">
                  <ClaimField label="Comparison" value={methodLabels[latest.comparisonMethod]} />
                  <ClaimField label="Source" value={sourceDisplayName(latest.sourceName)} />
                </dl>
                <CodeDisclosure label={evidencePayloadLabel(latest)} value={latest.content ?? null} />
                <CodeDisclosure
                  label="Audit details"
                  value={{ evidenceFingerprint: latest.resultHash, sourceReference: latest.sourceReference }}
                />
              </>
            ) : (
              <EmptyDetail>No evidence was available for this claim.</EmptyDetail>
            )}
          </section>

          <section className="dossier-section">
            <SectionHeading icon={TriangleAlertIcon} label="Issues encountered" />
            {failures.length ? (
              <ol className="failure-history">
                {failures.map((failure) => (
                  <li key={failure.id}>
                    <span className="failure-history__node" />
                    <div>
                      <p><strong>{friendlyFailureStage(failure.stage)}</strong><time>{formatTime(failure.createdAt)}</time></p>
                      <span>{failure.message}</span>
                      {failure.details != null
                        ? <CodeDisclosure label="More information" value={failure.details} />
                        : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="failure-clear"><CheckCircle2Icon />No issues encountered.</p>
            )}
          </section>
      </div>
    </article>
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
  if (plan.sourceType === "mcp") return sourceDisplayName(plan.server ?? plan.tool ?? "Connected source");
  if (plan.sourceType === "web_search") return "Public web";
  return "No evidence source";
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
        <p>{sourceDisplayName(source.tool ?? source.title ?? "Evidence source")}</p>
        <span>
          {source.sourceKind === "web_search"
            ? "Public web source"
            : `${friendlyName(source.server ?? "Connected source")} · trusted evidence`}
        </span>
      </div>
      {selected && <Badge variant="secondary">selected</Badge>}
    </div>
  );
}

function evidencePayloadLabel(evidence: Evidence): string {
  return evidence.comparisonMethod === "model_assisted_web"
    ? "Evidence details"
    : "Original evidence record";
}

function friendlyName(value: string): string {
  return value.replace(/[\/_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function sourceDisplayName(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes("company_get_metric") || normalized === "company_data") return "Company records";
  if (normalized.includes("web_search")) return "Public web";
  return friendlyName(value);
}

function planRationale(plan: NonNullable<Evidence["selectedPlan"]>): string {
  if (plan.sourceType === "web_search") {
    return "Public sources were selected because they best match the subject and timing of this claim.";
  }
  if (plan.sourceType === "mcp") {
    return "This trusted source was selected because it directly covers the subject, topic, and time period in the claim.";
  }
  return "No suitable evidence source was available for this claim.";
}

function friendlyFailureStage(stage: string): string {
  const normalized = stage.toLowerCase();
  if (normalized.includes("extract")) return "Understanding the claim";
  if (normalized.includes("source") || normalized.includes("plan")) return "Choosing evidence";
  if (normalized.includes("retriev") || normalized.includes("tool")) return "Collecting evidence";
  if (normalized.includes("compar") || normalized.includes("verif")) return "Comparing the evidence";
  return "Reviewing the claim";
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
