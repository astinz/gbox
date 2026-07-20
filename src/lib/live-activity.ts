import type { CodexEvent } from "@/types/gbox";

export type LiveActivitySource = "codex" | "replay";
export type LiveActivityPhase = "working" | "complete" | "failed";

export type LiveActivityItem = {
  id: string;
  label: string;
  detail?: string;
  state: "active" | "complete" | "failed";
  createdAt: string;
};

export type LiveActivityModel = {
  visible: boolean;
  phase: LiveActivityPhase;
  headline: string;
  detail: string;
  items: LiveActivityItem[];
};

type ActivityOptions = {
  busy: boolean;
  sessionId?: string;
  startedAt?: string;
  source?: LiveActivitySource;
};

const MAX_DETAIL_LENGTH = 320;
const MAX_VISIBLE_ITEMS = 4;

export function buildLiveActivity(
  events: CodexEvent[],
  { busy, sessionId, startedAt, source = "codex" }: ActivityOptions,
): LiveActivityModel {
  if (!startedAt) return hiddenActivity();

  const relevant = events
    .filter((event) => isRelevantEvent(event, startedAt, source, sessionId))
    .reverse();
  const items = new Map<string, LiveActivityItem>();

  for (const event of relevant) applyEvent(items, event);

  const ordered = [...items.values()];
  const turn = lastMatching(ordered, (item) => item.id.startsWith("turn:"));
  const failed = lastMatching(ordered, (item) => item.state === "failed");
  const active = lastMatching(ordered, (item) => item.state === "active");
  const latestWork = lastMatching(
    ordered,
    (item) => !item.id.startsWith("thread:") && !item.id.startsWith("turn:"),
  );
  const latest = failed
    ?? (active?.id !== turn?.id ? active : undefined)
    ?? latestWork
    ?? turn
    ?? ordered[ordered.length - 1];
  const phase = failed ? "failed" : busy || turn?.state === "active" ? "working" : "complete";

  return {
    visible: true,
    phase,
    headline: latest?.label ?? (source === "replay" ? "Preparing replay" : "Connecting to Codex"),
    detail: latest?.detail ?? connectingDetail(source),
    items: ordered.slice(-MAX_VISIBLE_ITEMS).reverse(),
  };
}

function applyEvent(items: Map<string, LiveActivityItem>, event: CodexEvent) {
  const payload = asRecord(event.payload);
  const item = asRecord(payload.item);
  const itemId = stringValue(item.id) ?? stringValue(payload.itemId) ?? event.id;

  if (event.method === "thread/started") {
    upsert(items, `thread:${event.sessionId ?? itemId}`, "Connected to Codex App Server", "The hosted thread is ready.", "complete", event);
    return;
  }
  if (event.method === "turn/started") {
    const turnId = stringValue(asRecord(payload.turn).id) ?? stringValue(payload.turnId) ?? itemId;
    upsert(items, `turn:${turnId}`, "Codex turn started", "Waiting for the first observable model activity.", "active", event);
    return;
  }
  if (event.method === "turn/completed") {
    const turnRecord = asRecord(payload.turn);
    const turnId = stringValue(turnRecord.id) ?? stringValue(payload.turnId) ?? itemId;
    const status = stringValue(turnRecord.status);
    const state = status === "failed" ? "failed" : "complete";
    upsert(items, `turn:${turnId}`, state === "failed" ? "Codex turn failed" : "Codex turn complete", status ? `Final status: ${status}.` : "The response stream has finished.", state, event);
    return;
  }

  if (event.method === "item/reasoning/textDelta") return;

  if (event.method === "item/reasoning/summaryTextDelta") {
    const key = `reasoning:${itemId}:${numberValue(payload.summaryIndex) ?? 0}`;
    const prior = items.get(key)?.detail ?? "";
    const detail = compact(`${prior}${stringValue(payload.delta) ?? ""}`);
    upsert(items, key, "Reasoning summary", detail || "Codex is summarizing its approach.", "active", event);
    return;
  }

  if (event.method === "item/mcpToolCall/progress") {
    const key = `mcp:${itemId}`;
    const prior = items.get(key);
    upsert(items, key, prior?.label ?? "MCP tool call", compact(stringValue(payload.message) ?? "The evidence source is responding."), "active", event);
    return;
  }

  if (event.method === "item/agentMessage/delta") {
    const key = `message:${itemId}`;
    const prior = items.get(key)?.detail ?? "";
    const detail = compact(`${prior}${stringValue(payload.delta) ?? ""}`);
    upsert(items, key, "Streaming assistant response", detail || "The final response is arriving.", "active", event);
    return;
  }

  if (event.method !== "item/started" && event.method !== "item/completed") return;
  const complete = event.method === "item/completed";
  applyThreadItem(items, itemId, item, complete, event);
}

function applyThreadItem(
  items: Map<string, LiveActivityItem>,
  itemId: string,
  item: Record<string, unknown>,
  complete: boolean,
  event: CodexEvent,
) {
  const type = stringValue(item.type);
  const state = complete ? "complete" : "active";
  if (type === "reasoning") {
    const summary = stringArray(item.summary).join(" ");
    upsert(items, `reasoning:${itemId}:0`, "Reasoning summary", compact(summary) || "Codex is evaluating the instruction.", state, event);
  } else if (type === "mcpToolCall") {
    const server = stringValue(item.server);
    const tool = stringValue(item.tool);
    const name = [server, tool].filter(Boolean).join(" / ");
    const status = stringValue(item.status);
    upsert(items, `mcp:${itemId}`, name ? `MCP · ${name}` : "MCP tool call", status ? `Tool status: ${status}.` : "Calling a configured evidence source.", status === "failed" ? "failed" : state, event);
  } else if (type === "webSearch") {
    const query = compact(stringValue(item.query) ?? "");
    upsert(items, `web:${itemId}`, "Web search", query ? `Query: ${query}` : "Searching configured public sources.", state, event);
  } else if (type === "commandExecution") {
    const status = stringValue(item.status);
    upsert(items, `command:${itemId}`, "Read-only command", status ? `Command status: ${status}.` : "Inspecting the hosted workspace.", status === "failed" ? "failed" : state, event);
  } else if (type === "fileChange") {
    upsert(items, `file:${itemId}`, "File change", complete ? "The file operation finished." : "A file operation was requested.", state, event);
  } else if (type === "agentMessage") {
    const text = compact(stringValue(item.text) ?? "");
    upsert(items, `message:${itemId}`, complete ? "Assistant response received" : "Streaming assistant response", text || "The response is being composed.", state, event);
  } else if (type === "contextCompaction") {
    upsert(items, `context:${itemId}`, "Context compacted", "Codex condensed earlier context before continuing.", state, event);
  }
}

function upsert(
  items: Map<string, LiveActivityItem>,
  id: string,
  label: string,
  detail: string,
  state: LiveActivityItem["state"],
  event: CodexEvent,
) {
  const existing = items.get(id);
  if (existing && existing.state !== "active" && state === "active") return;
  items.set(id, {
    id,
    label,
    detail,
    state: existing?.state === "failed" ? "failed" : state,
    createdAt: existing?.createdAt ?? event.createdAt,
  });
}

function isRelevantEvent(
  event: CodexEvent,
  startedAt: string,
  source: LiveActivitySource,
  sessionId?: string,
): boolean {
  if (event.source !== source) return false;
  if (sessionId && event.sessionId && event.sessionId !== sessionId) return false;
  const start = Date.parse(startedAt);
  const created = Date.parse(event.createdAt);
  return Number.isNaN(start) || Number.isNaN(created) || created >= start;
}

function compact(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_DETAIL_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_DETAIL_LENGTH - 1).trimEnd()}…`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function lastMatching(
  items: LiveActivityItem[],
  predicate: (item: LiveActivityItem) => boolean,
): LiveActivityItem | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return items[index];
  }
  return undefined;
}

function connectingDetail(source: LiveActivitySource): string {
  return source === "replay"
    ? "Loading recorded events through the real gBox pipeline."
    : "Starting the App Server and opening a read-only hosted thread.";
}

function hiddenActivity(): LiveActivityModel {
  return {
    visible: false,
    phase: "complete",
    headline: "",
    detail: "",
    items: [],
  };
}
