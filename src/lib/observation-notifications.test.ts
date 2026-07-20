import { beforeEach, describe, expect, it, vi } from "vitest";

const notificationMocks = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
  registerActionTypes: vi.fn(),
  onAction: vi.fn(),
}));
const windowMocks = vi.hoisted(() => ({
  show: vi.fn(),
  unminimize: vi.fn(),
  setFocus: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => windowMocks }));
vi.mock("@tauri-apps/plugin-notification", () => notificationMocks);

import {
  boundedSanitizedExcerpt,
  checkNativeNotificationPermission,
  listenForNotificationTargets,
  notificationContent,
  requestNativeNotificationPermission,
} from "@/lib/observation-notifications";
import type { Observation } from "@/types/gbox";

describe("observation notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationMocks.isPermissionGranted.mockResolvedValue(false);
    notificationMocks.requestPermission.mockResolvedValue("granted");
    notificationMocks.registerActionTypes.mockResolvedValue(undefined);
    windowMocks.show.mockResolvedValue(undefined);
    windowMocks.unminimize.mockResolvedValue(undefined);
    windowMocks.setFocus.mockResolvedValue(undefined);
  });

  it("checks permission without prompting until explicit opt-in", async () => {
    expect(await checkNativeNotificationPermission()).toBe("denied");
    expect(notificationMocks.requestPermission).not.toHaveBeenCalled();

    expect(await requestNativeNotificationPermission()).toBe("granted");
    expect(notificationMocks.requestPermission).toHaveBeenCalledOnce();
  });

  it("prioritizes contradicted claims in one turn-level notification", () => {
    const content = notificationContent(observation({
      verified: 3,
      contradicted: 1,
      unverifiable: 2,
    }));

    expect(content.title).toBe("Claim contradicted");
    expect(content.body).toContain("1 contradicted · 2 review · 3 verified");
  });

  it("sanitizes notification text and bounds the excerpt to 160 characters", () => {
    const excerpt = boundedSanitizedExcerpt(`claim\n\u0000${"x".repeat(220)}`, 160);

    expect(excerpt).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect([...excerpt]).toHaveLength(160);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("routes a notification action to the existing window and claim target", async () => {
    let action: ((notification: { extra?: Record<string, unknown> }) => void) | undefined;
    notificationMocks.onAction.mockImplementation(async (handler) => {
      action = handler;
      return { unregister: vi.fn() };
    });
    const onTarget = vi.fn();
    await listenForNotificationTargets(onTarget);

    action?.({ extra: { observationId: "observation-1", primaryClaimId: "claim-1" } });
    await vi.waitFor(() => expect(windowMocks.setFocus).toHaveBeenCalledOnce());
    expect(onTarget).toHaveBeenCalledWith({
      observationId: "observation-1",
      primaryClaimId: "claim-1",
    });
  });
});

function observation(
  verdictCounts: Observation["verdictCounts"],
): Observation {
  return {
    id: "observation-1",
    sessionId: "session-1",
    source: "codex-stop-hook",
    messageHash: "hash",
    messageExcerpt: "Acme had 42 production database users in 2026-Q2.",
    state: "Completed",
    attempts: 1,
    primaryClaimId: "claim-1",
    verdictCounts,
    notificationState: "Pending",
    notificationTarget: {
      observationId: "observation-1",
      primaryClaimId: "claim-1",
    },
    createdAt: "2026-07-21T00:00:00.000Z",
  };
}
