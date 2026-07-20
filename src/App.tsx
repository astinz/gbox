import { getCurrentWindow } from "@tauri-apps/api/window";
import { CircleAlertIcon, ShieldCheckIcon } from "lucide-react";

import { ActionHistory } from "@/components/action-history";
import { ApprovalPanel } from "@/components/approval-panel";
import { ClaimLedger } from "@/components/claim-ledger";
import { EventTimeline } from "@/components/event-timeline";
import { EvidenceSettingsPanel } from "@/components/evidence-settings";
import { StatusBoard } from "@/components/status-board";
import { TaskComposer } from "@/components/task-composer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGbox } from "@/hooks/use-gbox";

function App() {
  if (getCurrentWindow().label === "approval") return <ApprovalPanel />;
  return <Dashboard />;
}

function Dashboard() {
  const gbox = useGbox();

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark"><ShieldCheckIcon /></span>
          <div><span className="brand-name">gBox</span><span className="brand-subtitle">evidence & control layer</span></div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={gbox.snapshot.status.receiptChainValid ? "outline" : "destructive"}>
            Chain {gbox.snapshot.status.receiptChainValid ? "verified" : "broken"}
          </Badge>
          <Badge variant="secondary">macOS local</Badge>
        </div>
      </header>

      {gbox.error && (
        <Alert variant="destructive" className="mb-4">
          <CircleAlertIcon />
          <AlertTitle>gBox could not complete the request</AlertTitle>
          <AlertDescription>{gbox.error}</AlertDescription>
        </Alert>
      )}

      <section className="top-grid">
        <TaskComposer
          busy={gbox.busy}
          sessionId={gbox.sessionId}
          onStartLive={(cwd, prompt) => void gbox.startLive(cwd, prompt)}
          onContinue={(prompt) => void gbox.sendPrompt(prompt)}
          onReplay={() => void gbox.startReplay()}
        />
        <StatusBoard
          status={gbox.snapshot.status}
          onObservationChange={(enabled) => void gbox.setGlobalObservation(enabled)}
        />
      </section>

      <EvidenceSettingsPanel
        settings={gbox.snapshot.evidenceSettings}
        sources={gbox.snapshot.evidenceSources}
        busy={gbox.busy}
        onSave={(settings) => void gbox.updateEvidenceSettings(settings)}
      />

      <Tabs defaultValue="claims" className="mt-4">
        <TabsList variant="line" className="mb-3">
          <TabsTrigger value="claims">Claims <span className="tab-count">{gbox.snapshot.claims.length}</span></TabsTrigger>
          <TabsTrigger value="events">App Server <span className="tab-count">{gbox.snapshot.events.length}</span></TabsTrigger>
          <TabsTrigger value="actions">Actions & receipts <span className="tab-count">{gbox.snapshot.actions.length}</span></TabsTrigger>
        </TabsList>
        <TabsContent value="claims">
          <ClaimLedger
            claims={gbox.snapshot.claims}
            evidence={gbox.snapshot.evidence}
            failures={gbox.snapshot.verificationFailures}
          />
        </TabsContent>
        <TabsContent value="events"><EventTimeline events={gbox.snapshot.events} /></TabsContent>
        <TabsContent value="actions"><ActionHistory actions={gbox.snapshot.actions} receipts={gbox.snapshot.receipts} /></TabsContent>
      </Tabs>
    </main>
  );
}

export default App;
