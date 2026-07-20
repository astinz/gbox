import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  DashboardSnapshot,
  EvidenceSettings,
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
  updateEvidenceSettings: (settings: EvidenceSettings) =>
    invoke<DashboardSnapshot>("update_evidence_settings", { input: { settings } }),
};

const refreshEvents = [
  "gbox://system-status",
  "gbox://codex-event",
  "gbox://claim-updated",
  "gbox://approval-requested",
  "gbox://receipt-created",
] as const;

export async function listenForGboxChanges(
  refresh: () => void,
  onApproval?: (action: PendingAction) => void,
): Promise<UnlistenFn> {
  const unlisten = await Promise.all(
    refreshEvents.map((eventName) =>
      listen(eventName, (event) => {
        if (eventName === "gbox://approval-requested" && onApproval) {
          onApproval(event.payload as PendingAction);
        }
        refresh();
      }),
    ),
  );
  return () => unlisten.forEach((dispose) => dispose());
}
