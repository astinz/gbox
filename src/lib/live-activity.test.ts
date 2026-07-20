import { describe, expect, it } from "vitest";

import { buildLiveActivity } from "@/lib/live-activity";
import type { CodexEvent } from "@/types/gbox";

const startedAt = "2026-07-20T10:00:00.000Z";

describe("live activity", () => {
  it("shows connection feedback before the first App Server event", () => {
    const activity = buildLiveActivity([], { busy: true, startedAt });
    expect(activity.visible).toBe(true);
    expect(activity.phase).toBe("working");
    expect(activity.headline).toBe("Connecting to Codex");
    expect(activity.detail).toContain("read-only hosted thread");
  });

  it("assembles public reasoning summaries in event order", () => {
    const events = [
      event("summary-2", "item/reasoning/summaryTextDelta", {
        itemId: "reasoning-1",
        summaryIndex: 0,
        delta: " metric source.",
      }, "2026-07-20T10:00:02.000Z"),
      event("summary-1", "item/reasoning/summaryTextDelta", {
        itemId: "reasoning-1",
        summaryIndex: 0,
        delta: "Checking the company",
      }, "2026-07-20T10:00:01.000Z"),
      event("turn", "turn/started", {
        turn: { id: "turn-1", status: "inProgress" },
      }),
    ];
    const activity = buildLiveActivity(events, { busy: false, startedAt, sessionId: "thread-1" });
    expect(activity.phase).toBe("working");
    expect(activity.headline).toBe("Reasoning summary");
    expect(activity.detail).toBe("Checking the company metric source.");
  });

  it("never surfaces raw reasoning text deltas", () => {
    const activity = buildLiveActivity([
      event("private", "item/reasoning/textDelta", {
        itemId: "reasoning-1",
        delta: "private hidden reasoning",
      }),
      event("turn", "turn/started", { turn: { id: "turn-1" } }),
    ], { busy: false, startedAt });
    expect(JSON.stringify(activity)).not.toContain("private hidden reasoning");
    expect(activity.items.map((item) => item.label)).toEqual(["Codex turn started"]);
  });

  it("names MCP calls and marks the turn complete", () => {
    const events = [
      event("complete", "turn/completed", { turn: { id: "turn-1", status: "completed" } }, "2026-07-20T10:00:03.000Z"),
      event("tool-complete", "item/completed", {
        item: {
          id: "tool-1",
          type: "mcpToolCall",
          server: "company_data",
          tool: "company_get_metric",
          status: "completed",
        },
      }, "2026-07-20T10:00:02.000Z"),
      event("tool-start", "item/started", {
        item: {
          id: "tool-1",
          type: "mcpToolCall",
          server: "company_data",
          tool: "company_get_metric",
          status: "inProgress",
        },
      }, "2026-07-20T10:00:01.000Z"),
      event("turn", "turn/started", { turn: { id: "turn-1" } }),
    ];
    const activity = buildLiveActivity(events, { busy: false, startedAt });
    expect(activity.phase).toBe("complete");
    expect(activity.items.some((item) => item.label === "MCP · company_data / company_get_metric")).toBe(true);
    expect(activity.items.some((item) => item.label === "Codex turn complete")).toBe(true);
  });

  it("does not let a late delta overwrite a completed response", () => {
    const events = [
      event("turn-complete", "turn/completed", {
        turn: { id: "turn-1", status: "completed" },
      }, "2026-07-20T10:00:04.000Z"),
      event("late-delta", "item/agentMessage/delta", {
        itemId: "message-1",
        delta: "late duplicate text",
      }, "2026-07-20T10:00:03.000Z"),
      event("message-complete", "item/completed", {
        item: { id: "message-1", type: "agentMessage", text: "Final answer." },
      }, "2026-07-20T10:00:02.000Z"),
      event("turn", "turn/started", { turn: { id: "turn-1" } }),
    ];
    const activity = buildLiveActivity(events, { busy: false, startedAt });
    expect(activity.headline).toBe("Assistant response received");
    expect(activity.detail).toBe("Final answer.");
  });

  it("keeps the latest completed work visible while the turn finalizes", () => {
    const events = [
      event("message-complete", "item/completed", {
        item: { id: "message-1", type: "agentMessage", text: "Evidence checked." },
      }, "2026-07-20T10:00:02.000Z"),
      event("turn", "turn/started", { turn: { id: "turn-1" } }),
    ];
    const activity = buildLiveActivity(events, { busy: false, startedAt });
    expect(activity.phase).toBe("working");
    expect(activity.headline).toBe("Assistant response received");
    expect(activity.detail).toBe("Evidence checked.");
  });
});

function event(
  id: string,
  method: string,
  payload: unknown,
  createdAt = "2026-07-20T10:00:00.100Z",
): CodexEvent {
  return {
    id,
    sessionId: "thread-1",
    method,
    summary: method,
    payload,
    source: "codex",
    createdAt,
  };
}
