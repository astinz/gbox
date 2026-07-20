import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { gboxApi } from "@/lib/gbox-api";
import {
  checkNativeNotificationPermission,
  listenForNotificationTargets,
  requestNativeNotificationPermission,
  sendObservationNotification,
  type NativeNotificationPermission,
} from "@/lib/observation-notifications";
import type { NotificationTarget, Observation } from "@/types/gbox";

export function useObservationNotifications(
  observations: Observation[],
  onChanged: () => Promise<void>,
) {
  const [permission, setPermission] = useState<NativeNotificationPermission | "checking">(
    "checking",
  );
  const [target, setTarget] = useState<NotificationTarget>();
  const attempted = useRef(new Set<string>());

  useEffect(() => {
    if (!isTauri()) {
      setPermission("unavailable");
      return;
    }
    let dispose: () => void = () => undefined;
    void checkNativeNotificationPermission().then(async (current) => {
      setPermission(current);
      await gboxApi.setNotificationsAvailable(current === "granted");
    });
    void listenForNotificationTargets(setTarget).then((unlisten) => {
      dispose = unlisten;
    });
    return () => dispose();
  }, []);

  useEffect(() => {
    if (permission === "checking") return;
    const pending = observations.filter(
      (observation) => observation.notificationState === "Pending"
        && !attempted.current.has(observation.id),
    );
    for (const observation of pending) {
      attempted.current.add(observation.id);
      void deliver(observation, permission).finally(() => void onChanged());
    }
  }, [observations, onChanged, permission]);

  const requestPermission = useCallback(async () => {
    const next = await requestNativeNotificationPermission();
    setPermission(next);
    if (isTauri()) await gboxApi.setNotificationsAvailable(next === "granted");
    return next;
  }, []);

  return {
    notificationPermission: permission,
    notificationTarget: target,
    clearNotificationTarget: () => setTarget(undefined),
    requestNotificationPermission: requestPermission,
  };
}

async function deliver(
  observation: Observation,
  permission: NativeNotificationPermission,
): Promise<void> {
  if (permission !== "granted") {
    await gboxApi.markObservationNotified(observation.id, "Failed");
    return;
  }
  try {
    sendObservationNotification(observation);
    await gboxApi.markObservationNotified(observation.id, "Sent");
  } catch {
    await gboxApi.markObservationNotified(observation.id, "Failed");
  }
}
