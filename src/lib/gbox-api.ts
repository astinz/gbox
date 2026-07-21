import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  DashboardSnapshot,
  CodexEvent,
  EvidenceSettings,
  NotificationState,
  Observation,
  PendingAction,
  SystemStatus,
} from "@/types/gbox";

export type LiveSessionResult = { sessionId: string; turnId: string };

export const gboxApi = {
  snapshot: () => invoke<DashboardSnapshot>("get_dashboard_snapshot"),
  status: () => invoke<SystemStatus>("get_system_status"),
  verifyReceipts: () => invoke<boolean>("verify_receipt_chain"),
  startReplay: () => invoke<DashboardSnapshot>("start_replay"),
  startLive: (cwd: string, prompt: string) =>
    invoke<LiveSessionResult>("start_live_session", {
      input: { cwd, prompt },
    }),
  sendPrompt: (sessionId: string, prompt: string) =>
    invoke<string>("send_live_prompt", {
      input: { sessionId, prompt },
    }),
  resolveAction: (actionId: string, decision: "approve" | "deny") =>
    invoke("resolve_action", { input: { actionId, decision } }),
  setGlobalObservation: (enabled: boolean) =>
    invoke<SystemStatus>("set_global_observation", { enabled }),
  setLaunchAtLogin: (enabled: boolean) =>
    invoke<SystemStatus>("set_launch_at_login", { enabled }),
  setNotchEnabled: (enabled: boolean) =>
    invoke<SystemStatus>("set_notch_enabled", { enabled }),
  setNotchPresentation: (expanded: boolean) =>
    invoke<void>("set_notch_presentation", { expanded }),
  openMainWindow: (observationId?: string, primaryClaimId?: string) =>
    invoke<void>("open_main_window", { observationId, primaryClaimId }),
  setNotificationsAvailable: (available: boolean) =>
    invoke<SystemStatus>("set_notifications_available", { available }),
  markObservationNotified: (observationId: string, notificationState: NotificationState) =>
    invoke<Observation>("mark_observation_notified", { observationId, notificationState }),
  retryObservation: (observationId: string) =>
    invoke<Observation>("retry_observation", { observationId }),
  updateEvidenceSettings: (settings: EvidenceSettings) =>
    invoke<DashboardSnapshot>("update_evidence_settings", { input: { settings } }),
};

const refreshEvents = [
  "gbox://system-status",
  "gbox://codex-event",
  "gbox://claim-updated",
  "gbox://approval-requested",
  "gbox://receipt-created",
  "gbox://observation-queued",
  "gbox://observation-completed",
  "gbox://observation-failed",
] as const;

export async function listenForGboxChanges(
  refresh: () => void,
  onApproval?: (action: PendingAction) => void,
  onCodexEvent?: (event: CodexEvent) => void,
): Promise<UnlistenFn> {
  const unlisten = await Promise.all(
    refreshEvents.map((eventName) =>
      listen(eventName, (event) => {
        if (eventName === "gbox://approval-requested" && onApproval) {
          onApproval(event.payload as PendingAction);
        }
        if (eventName === "gbox://codex-event") {
          onCodexEvent?.(event.payload as CodexEvent);
        } else {
          refresh();
        }
      }),
    ),
  );
  return () => unlisten.forEach((dispose) => dispose());
}
