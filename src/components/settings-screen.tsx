import { EvidenceSettingsPanel } from "@/components/evidence-settings";
import { StatusBoard } from "@/components/status-board";
import type { DashboardSnapshot, EvidenceSettings } from "@/types/gbox";

type Props = {
  snapshot: DashboardSnapshot;
  busy: boolean;
  onObservationChange: (enabled: boolean) => void;
  onLaunchAtLoginChange: (enabled: boolean) => void;
  onNotchChange: (enabled: boolean) => void;
  onSaveEvidence: (settings: EvidenceSettings) => void;
};

export function SettingsScreen({
  snapshot,
  busy,
  onObservationChange,
  onLaunchAtLoginChange,
  onNotchChange,
  onSaveEvidence,
}: Props) {
  return (
    <>
      <section className="page-intro page-intro--settings">
        <div>
          <p className="eyebrow">Preferences</p>
          <h1>Settings</h1>
        </div>
        <p>Choose how gBox monitors research, alerts you, and finds evidence.</p>
      </section>
      <section className="settings-layout">
        <StatusBoard
          status={snapshot.status}
          onObservationChange={onObservationChange}
          onLaunchAtLoginChange={onLaunchAtLoginChange}
          onNotchChange={onNotchChange}
        />
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
