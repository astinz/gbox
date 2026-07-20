import { useCallback, useEffect, useMemo, useState } from "react";

import { gboxApi, listenForGboxChanges } from "@/lib/gbox-api";
import type { LiveActivitySource } from "@/lib/live-activity";
import type { CodexEvent } from "@/types/gbox";
import { emptySnapshot, type DashboardSnapshot } from "@/types/gbox";
import type { EvidenceSettings } from "@/types/gbox";
import { useObservationNotifications } from "@/hooks/use-observation-notifications";

export function useGbox() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(emptySnapshot);
  const [sessionId, setSessionId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [activityStartedAt, setActivityStartedAt] = useState<string>();
  const [activitySource, setActivitySource] = useState<LiveActivitySource>();
  const [activityEvents, setActivityEvents] = useState<CodexEvent[]>([]);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await gboxApi.snapshot());
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  const receiveCodexEvent = useCallback((event: CodexEvent) => {
    setActivityEvents((current) => current.some((item) => item.id === event.id)
      ? current
      : [event, ...current].slice(0, 300));
    setSnapshot((current) => current.events.some((item) => item.id === event.id)
      ? current
      : { ...current, events: [event, ...current.events].slice(0, 300) });
  }, []);

  useEffect(() => {
    void refresh();
    let dispose: (() => void) | undefined;
    void listenForGboxChanges(() => void refresh(), undefined, receiveCodexEvent).then((unlisten) => {
      dispose = unlisten;
    });
    return () => dispose?.();
  }, [receiveCodexEvent, refresh]);

  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await operation();
      await refresh();
      return result;
    } catch (cause) {
      setError(errorMessage(cause));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const notifications = useObservationNotifications(snapshot.recentObservations, refresh);

  return useMemo(
    () => ({
      snapshot,
      sessionId,
      busy,
      error,
      activityStartedAt,
      activitySource,
      activityEvents,
      notificationPermission: notifications.notificationPermission,
      notificationTarget: notifications.notificationTarget,
      clearNotificationTarget: notifications.clearNotificationTarget,
      clearError: () => setError(undefined),
      startReplay: () => {
        setActivityStartedAt(new Date().toISOString());
        setActivitySource("replay");
        setActivityEvents([]);
        return run(() => gboxApi.startReplay());
      },
      startLive: async (cwd: string, prompt: string) => {
        setActivityStartedAt(new Date().toISOString());
        setActivitySource("codex");
        setActivityEvents([]);
        const result = await run(() => gboxApi.startLive(cwd, prompt));
        if (result && "sessionId" in result) setSessionId(result.sessionId);
      },
      sendPrompt: (prompt: string) => {
        if (!sessionId) return Promise.resolve();
        setActivityStartedAt(new Date().toISOString());
        setActivitySource("codex");
        setActivityEvents([]);
        return run(() => gboxApi.sendPrompt(sessionId, prompt));
      },
      setGlobalObservation: async (enabled: boolean) => {
        if (enabled) await notifications.requestNotificationPermission();
        return run(() => gboxApi.setGlobalObservation(enabled));
      },
      setLaunchAtLogin: (enabled: boolean) =>
        run(() => gboxApi.setLaunchAtLogin(enabled)),
      retryObservation: (observationId: string) =>
        run(() => gboxApi.retryObservation(observationId)),
      updateEvidenceSettings: (settings: EvidenceSettings) =>
        run(() => gboxApi.updateEvidenceSettings(settings)),
      resolveAction: (actionId: string, decision: "approve" | "deny") =>
        run(() => gboxApi.resolveAction(actionId, decision)),
    }),
    [
      snapshot,
      sessionId,
      busy,
      error,
      activityStartedAt,
      activitySource,
      activityEvents,
      notifications,
      run,
    ],
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
