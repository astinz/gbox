import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

import { gboxApi } from "@/lib/gbox-api";
import {
  observationVerdict,
  shouldExpandNotch,
  type NotchPhase,
} from "@/lib/notch-presentation";
import type { Observation, SystemStatus } from "@/types/gbox";

const CAPTURED_DURATION_MS = 900;
const RESULT_DURATION_MS = 6_000;

export function useObservationNotch() {
  const [phase, setPhase] = useState<NotchPhase>("watching");
  const [observation, setObservation] = useState<Observation>();
  const [queueDepth, setQueueDepth] = useState(0);
  const [hovered, setHovered] = useState(false);
  const timers = useRef<number[]>([]);
  const hoverTimer = useRef<number | undefined>(undefined);

  const clearTimers = useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  }, []);

  const refreshQueue = useCallback(async () => {
    const snapshot = await gboxApi.snapshot();
    setQueueDepth(snapshot.observationQueueDepth);
  }, []);

  const showQueued = useCallback((next: Observation) => {
    clearTimers();
    setObservation(next);
    setPhase("captured");
    timers.current.push(window.setTimeout(() => setPhase("checking"), CAPTURED_DURATION_MS));
    void refreshQueue();
  }, [clearTimers, refreshQueue]);

  const showResult = useCallback((next: Observation, failed = false) => {
    clearTimers();
    setObservation(next);
    const contradicted = !failed && observationVerdict(next) === "contradicted";
    setPhase(failed ? "failed" : contradicted ? "completed" : "watching");
    if (failed || contradicted) {
      timers.current.push(window.setTimeout(() => setPhase("watching"), RESULT_DURATION_MS));
    }
    void refreshQueue();
  }, [clearTimers, refreshQueue]);

  const setHoverIntent = useCallback((inside: boolean) => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(
      () => setHovered(inside),
      inside ? 120 : 260,
    );
  }, []);

  useEffect(() => {
    void gboxApi.snapshot().then((snapshot) => {
      setQueueDepth(snapshot.observationQueueDepth);
      setObservation(snapshot.recentObservations[0]);
      const active = snapshot.recentObservations.find(
        (item) => item.state === "Pending" || item.state === "Processing",
      );
      if (active) {
        setObservation(active);
        setPhase("checking");
      }
    });

    let dispose: UnlistenFn = () => undefined;
    void Promise.all([
      listen<Observation>("gbox://observation-queued", (event) => showQueued(event.payload)),
      listen<Observation>("gbox://observation-completed", (event) => showResult(event.payload)),
      listen<Observation>("gbox://observation-failed", (event) => {
        if (isObservation(event.payload)) showResult(event.payload, true);
      }),
      listen<SystemStatus>("gbox://system-status", (event) => {
        setQueueDepth(event.payload.observationQueueDepth);
      }),
      listen<boolean>("gbox://notch-hover-changed", (event) => {
        setHoverIntent(event.payload);
      }),
    ]).then((unlisten) => {
      dispose = () => unlisten.forEach((stop) => stop());
    });
    return () => {
      dispose();
      clearTimers();
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    };
  }, [clearTimers, setHoverIntent, showQueued, showResult]);

  const expanded = shouldExpandNotch(hovered, phase, observation);
  useEffect(() => {
    void gboxApi.setNotchPresentation(expanded);
  }, [expanded]);

  const review = useCallback(async () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    setHovered(false);
    setPhase("watching");
    await gboxApi.setNotchPresentation(false);
    await gboxApi.openMainWindow(observation?.id, observation?.primaryClaimId);
  }, [observation?.id, observation?.primaryClaimId]);

  return {
    phase,
    expanded,
    previewingLatest: hovered && phase === "watching" && Boolean(observation),
    observation,
    queueDepth,
    review,
  };
}

function isObservation(value: unknown): value is Observation {
  return Boolean(value && typeof value === "object" && "id" in value && "state" in value);
}
