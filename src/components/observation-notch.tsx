import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  observationVerdict,
  phaseLabel,
  verdictSummary,
  type NotchPhase,
} from "@/lib/notch-presentation";
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
  const excerpt = observation?.messageExcerpt ?? "Waiting for a completed Codex turn";

  return (
    <section
      className="observation-notch"
      data-expanded={expanded}
      data-phase={phase}
      data-verdict={verdict}
      aria-label="gBox observation status"
      aria-live="polite"
    >
      {expanded ? (
        <>
          <header className="observation-notch__cap">
            <span className="observation-notch__brand">gBox</span>
            <span aria-hidden="true" />
            <span className="observation-notch__state">
              <i aria-hidden="true" />
              {label}
            </span>
          </header>
          <div className="observation-notch__body">
            <div className="observation-notch__capture">
              <span>{previewingLatest ? "Latest Codex observation" : "Captured from Codex"}</span>
              <strong>{excerpt}</strong>
              <small>{detailLine(phase, previewingLatest)}</small>
            </div>
            <div className="observation-notch__result">
              <span>Observation</span>
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
          <span aria-hidden="true" />
          <span className="sr-only">
            {queueDepth > 0 ? `${queueDepth} observations queued; open gBox` : "Open gBox"}
          </span>
        </button>
      )}
    </section>
  );
}

function detailLine(phase: NotchPhase, previewingLatest: boolean) {
  if (previewingLatest) return "Hover preview · open gBox for evidence";
  if (phase === "checking") return "Selecting eligible evidence sources";
  if (phase === "captured") return "Completed assistant response captured";
  if (phase === "failed") return "Open gBox to inspect the failure";
  return "Verification complete";
}

function badgeVariant(verdict: ReturnType<typeof observationVerdict>) {
  if (verdict === "contradicted") return "destructive" as const;
  if (verdict === "unverifiable") return "secondary" as const;
  return "outline" as const;
}
