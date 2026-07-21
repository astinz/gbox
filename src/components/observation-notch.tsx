import { GboxOrb } from "@/components/gbox-orb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  observationVerdict,
  phaseLabel,
  verdictSummary,
  type NotchPhase,
} from "@/lib/notch-presentation";
import { orbForNotch } from "@/lib/orb-state";
import type { Observation } from "@/types/gbox";

type Props = {
  phase: NotchPhase;
  expanded: boolean;
  previewingLatest?: boolean;
  observation?: Observation;
  queueDepth: number;
  onReview: () => void;
};

export function ObservationNotch({
  phase,
  expanded,
  previewingLatest = false,
  observation,
  queueDepth,
  onReview,
}: Props) {
  const verdict = observationVerdict(observation);
  const label = previewingLatest ? "Latest result" : phaseLabel(phase, observation);
  const verdictLabel = previewingLatest
    ? phaseLabel("completed", observation)
    : label;
  const excerpt = observation?.messageExcerpt ?? "Waiting for a completed response";
  const orb = orbForNotch(phase);
  const active = phase === "captured" || phase === "checking";

  return (
    <section
      className="observation-notch"
      data-expanded={expanded}
      data-phase={phase}
      data-verdict={verdict}
      aria-label="gBox claim status"
      aria-live="polite"
    >
      {expanded ? (
        <>
          <header className="observation-notch__cap">
            <span className="observation-notch__brand">gBox</span>
            <span aria-hidden="true" />
            <span className="observation-notch__state">
              <GboxOrb {...orb} theme="dark" />
              {label}
            </span>
          </header>
          <div className="observation-notch__body">
            <div className="observation-notch__capture">
              <span>{previewingLatest ? "Latest claim check" : "Response received"}</span>
              <strong>{excerpt}</strong>
              <small>{detailLine(phase, previewingLatest)}</small>
            </div>
            <div className="observation-notch__result">
              <span>Result</span>
              <div>
                <Badge variant={badgeVariant(verdict)}>{verdictLabel}</Badge>
                <Button variant="secondary" size="xs" onClick={onReview}>
                  Review
                </Button>
              </div>
              <small>{verdictSummary(observation)}</small>
            </div>
          </div>
        </>
      ) : (
        <button className="observation-notch__compact" type="button" onClick={onReview}>
          {active ? (
            <span className="observation-notch__compact-orb">
              <GboxOrb {...orb} theme="dark" />
            </span>
          ) : (
            <span className="observation-notch__compact-mark" aria-hidden="true" />
          )}
          <span className="sr-only">
            {queueDepth > 0 ? `${queueDepth} checks waiting; open gBox` : "Open gBox"}
          </span>
        </button>
      )}
    </section>
  );
}

function detailLine(phase: NotchPhase, previewingLatest: boolean) {
  if (previewingLatest) return "Open gBox to review the evidence";
  if (phase === "checking") return "Reviewing available evidence";
  if (phase === "captured") return "Response ready for review";
  if (phase === "failed") return "Open gBox to see what needs attention";
  return "Review complete";
}

function badgeVariant(verdict: ReturnType<typeof observationVerdict>) {
  if (verdict === "contradicted") return "destructive" as const;
  if (verdict === "unverifiable") return "secondary" as const;
  return "outline" as const;
}
