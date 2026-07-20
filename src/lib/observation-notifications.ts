import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  onAction,
  registerActionTypes,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import type { NotificationTarget, Observation } from "@/types/gbox";

export type NativeNotificationPermission = "granted" | "denied" | "unavailable";

const ACTION_TYPE = "gbox-observation";

export async function checkNativeNotificationPermission(): Promise<NativeNotificationPermission> {
  if (!isTauri()) return "unavailable";
  try {
    return (await isPermissionGranted()) ? "granted" : "denied";
  } catch {
    return "unavailable";
  }
}

export async function requestNativeNotificationPermission(): Promise<NativeNotificationPermission> {
  if (!isTauri()) return "unavailable";
  try {
    if (await isPermissionGranted()) return "granted";
    return (await requestPermission()) === "granted" ? "granted" : "denied";
  } catch {
    return "unavailable";
  }
}

export async function listenForNotificationTargets(
  onTarget: (target: NotificationTarget) => void,
): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  await registerActionTypes([
    {
      id: ACTION_TYPE,
      actions: [
        {
          id: "review",
          title: "Review in gBox",
          foreground: true,
        },
      ],
    },
  ]);
  const listener = await onAction((notification) => {
    const target = parseNotificationTarget(notification.extra);
    if (!target) return;
    void focusMainWindow();
    onTarget(target);
  });
  return () => void listener.unregister();
}

export function sendObservationNotification(observation: Observation): void {
  const target = observation.notificationTarget;
  if (!target) throw new Error("completed observation has no notification target");
  const notification = notificationContent(observation);
  sendNotification({
    title: notification.title,
    body: notification.body,
    actionTypeId: ACTION_TYPE,
    group: observation.sessionId,
    autoCancel: true,
    extra: target,
  });
}

export function notificationContent(observation: Observation): { title: string; body: string } {
  const counts = observation.verdictCounts;
  const title = counts.contradicted > 0
    ? "Claim contradicted"
    : counts.unverifiable > 0
      ? "Claim needs review"
      : "Claim verified";
  const excerpt = boundedSanitizedExcerpt(observation.messageExcerpt, 160);
  const summary = `${counts.contradicted} contradicted · ${counts.unverifiable} review · ${counts.verified} verified`;
  return { title, body: `${excerpt} — ${summary}` };
}

export function boundedSanitizedExcerpt(value: string, limit: number): string {
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
  if ([...sanitized].length <= limit) return sanitized;
  return `${[...sanitized].slice(0, Math.max(0, limit - 1)).join("")}…`;
}

function parseNotificationTarget(extra: Record<string, unknown> | undefined): NotificationTarget | undefined {
  const observationId = extra?.observationId;
  const primaryClaimId = extra?.primaryClaimId;
  if (typeof observationId !== "string" || typeof primaryClaimId !== "string") return undefined;
  return { observationId, primaryClaimId };
}

async function focusMainWindow(): Promise<void> {
  const window = getCurrentWindow();
  await window.show();
  await window.unminimize();
  await window.setFocus();
}
