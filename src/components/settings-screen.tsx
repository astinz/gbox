import { EvidenceSettingsPanel } from "@/components/evidence-settings";
import { StatusBoard } from "@/components/status-board";
import type { DashboardSnapshot, EvidenceSettings } from "@/types/gbox";

type Props = {
  snapshot: DashboardSnapshot;
  busy: boolean;
  onObservationChange: (enabled: boolean) => void;
  onSaveEvidence: (settings: EvidenceSettings) => void;
};

export function SettingsScreen({
  snapshot,
  busy,
  onObservationChange,
  onSaveEvidence,
}: Props) {
  return (
    <>
      <section className="page-intro page-intro--settings">
        <div>
          <p className="eyebrow">System-wide configuration</p>
          <h1>Settings</h1>
        </div>
        <p>Manage runtime trust, global observation, and the evidence sources available to every session.</p>
      </section>
      <section className="settings-layout">
        <StatusBoard status={snapshot.status} onObservationChange={onObservationChange} />
        <EvidenceSettingsPanel
          settings={snapshot.evidenceSettings}
          sources={snapshot.evidenceSources}
          busy={busy}
          onSave={onSaveEvidence}
        />
      </section>
    </>
  );
}
