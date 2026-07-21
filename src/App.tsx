import { useEffect, useState } from "react";
import { CircleAlertIcon } from "lucide-react";

import { AppHeader, type AppScreen } from "@/components/app-header";
import { ApprovalDialog } from "@/components/approval-dialog";
import { DashboardScreen } from "@/components/dashboard-screen";
import { SettingsScreen } from "@/components/settings-screen";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useGbox } from "@/hooks/use-gbox";

function App() {
  const gbox = useGbox();
  const [screen, setScreen] = useState<AppScreen>("dashboard");
  const pendingAction = gbox.snapshot.actions.find((action) => action.state === "Pending");

  useEffect(() => {
    if (gbox.notificationTarget) setScreen("dashboard");
  }, [gbox.notificationTarget]);

  return (
    <main className="app-shell">
      <AppHeader screen={screen} onNavigate={setScreen} />

      {gbox.error ? (
        <Alert variant="destructive" className="mb-4">
          <CircleAlertIcon />
          <AlertTitle>gBox could not complete the request</AlertTitle>
          <AlertDescription>{gbox.error}</AlertDescription>
        </Alert>
      ) : null}

      {screen === "dashboard" ? (
        <DashboardScreen
          snapshot={gbox.snapshot}
          busy={gbox.busy}
          sessionId={gbox.sessionId}
          activityStartedAt={gbox.activityStartedAt}
          activitySource={gbox.activitySource}
          activityEvents={gbox.activityEvents}
          notificationClaimId={gbox.notificationTarget?.primaryClaimId}
          onNotificationOpened={gbox.clearNotificationTarget}
          onStartLive={(cwd, prompt) => void gbox.startLive(cwd, prompt)}
          onContinue={(prompt) => void gbox.sendPrompt(prompt)}
          onReplay={() => void gbox.startReplay()}
          onRetryObservation={(observationId) => void gbox.retryObservation(observationId)}
        />
      ) : (
        <SettingsScreen
          snapshot={gbox.snapshot}
          busy={gbox.busy}
          onObservationChange={(enabled) => void gbox.setGlobalObservation(enabled)}
          onLaunchAtLoginChange={(enabled) => void gbox.setLaunchAtLogin(enabled)}
          onNotchChange={(enabled) => void gbox.setNotchEnabled(enabled)}
          onSaveEvidence={(settings) => void gbox.updateEvidenceSettings(settings)}
        />
      )}

      <ApprovalDialog
        action={pendingAction}
        claims={gbox.snapshot.claims}
        busy={gbox.busy}
        error={gbox.error}
        onResolve={gbox.resolveAction}
      />
    </main>
  );
}

export default App;
