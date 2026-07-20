import { useCallback, useEffect, useMemo, useState } from "react";

import { gboxApi, listenForGboxChanges } from "@/lib/gbox-api";
import { emptySnapshot, type DashboardSnapshot } from "@/types/gbox";

export function useGbox() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(emptySnapshot);
  const [sessionId, setSessionId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await gboxApi.snapshot());
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
    let dispose: (() => void) | undefined;
    void listenForGboxChanges(() => void refresh()).then((unlisten) => {
      dispose = unlisten;
    });
    return () => dispose?.();
  }, [refresh]);

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

  return useMemo(
    () => ({
      snapshot,
      sessionId,
      busy,
      error,
      clearError: () => setError(undefined),
      startReplay: () => run(() => gboxApi.startReplay()),
      startLive: async (cwd: string, prompt: string) => {
        const result = await run(() => gboxApi.startLive(cwd, prompt));
        if (result && "sessionId" in result) setSessionId(result.sessionId);
      },
      sendPrompt: (prompt: string) =>
        sessionId ? run(() => gboxApi.sendPrompt(sessionId, prompt)) : Promise.resolve(),
      setGlobalObservation: (enabled: boolean) =>
        run(() => gboxApi.setGlobalObservation(enabled)),
      resolveAction: (actionId: string, decision: "approve" | "deny") =>
        run(() => gboxApi.resolveAction(actionId, decision)),
    }),
    [snapshot, sessionId, busy, error, run],
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
