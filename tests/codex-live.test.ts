// @vitest-environment node
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import { afterEach, expect, it } from "vitest";

type Message = {
  id?: number;
  method?: string;
  result?: Record<string, unknown>;
  error?: unknown;
  params?: Record<string, unknown>;
};

const liveIt = process.env.GBOX_LIVE_CODEX_TEST === "1" ? it : it.skip;
let client: JsonlClient | undefined;

afterEach(() => client?.close());

liveIt(
  "streams genuine Codex thread, turn, assistant, and MCP events",
  async () => {
    client = new JsonlClient(process.env.GBOX_CODEX_BIN ?? "codex");
    await client.request("initialize", {
      clientInfo: { name: "gbox_live_test", title: "gBox live test", version: "0.1.0" },
    });
    client.notify("initialized", {});
    const started = await client.request("thread/start", {
      cwd: process.cwd(),
      sandbox: "read-only",
      approvalPolicy: "never",
    });
    const threadId = nestedString(started, "thread", "id");
    expect(threadId).toBeTruthy();
    const turn = await client.request("turn/start", {
      threadId,
      input: [
        {
          type: "text",
          text: "Evaluate this intentionally false claim: ‘Acme had 42 production database users in 2026-Q2.’ Call company_get_metric to verify it, then state both the claimed and authoritative values in one sentence.",
        },
      ],
      approvalPolicy: "never",
    });
    const turnId = nestedString(turn, "turn", "id");
    await client.waitFor(
      (message) =>
        message.method === "turn/completed" &&
        nestedString(message.params ?? {}, "turn", "id") === turnId,
      120_000,
    );

    expect(client.notifications.some((message) => message.method === "thread/started")).toBe(true);
    expect(client.notifications.some((message) => message.method === "turn/started")).toBe(true);
    expect(client.notifications.some(isAgentMessage)).toBe(true);
    expect(client.notifications.some(isMcpCall)).toBe(true);
    const assistantText = client.notifications
      .filter(isAgentMessage)
      .map((message) => nestedString(message.params ?? {}, "item", "text"))
      .join(" ");
    expect(assistantText).toContain("42");
    expect(assistantText).toContain("17");
  },
  130_000,
);

class JsonlClient {
  readonly notifications: Message[] = [];
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, (message: Message) => void>();
  private readonly waiters = new Set<() => void>();
  private nextId = 1;

  constructor(binary: string) {
    this.process = spawn(binary, ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: this.process.stdout });
    lines.on("line", (line) => {
      const message = JSON.parse(line) as Message;
      if (typeof message.id === "number" && !message.method) {
        this.pending.get(message.id)?.(message);
        this.pending.delete(message.id);
      } else {
        this.notifications.push(message);
        this.waiters.forEach((wake) => wake());
      }
    });
  }

  async request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const response = await new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 120_000);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      this.write({ id, method, params });
    });
    if (response.error) throw new Error(`${method} failed: ${JSON.stringify(response.error)}`);
    return response.result ?? {};
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.write({ method, params });
  }

  async waitFor(predicate: (message: Message) => boolean, timeoutMs: number): Promise<Message> {
    const existing = this.notifications.find(predicate);
    if (existing) return existing;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(check);
        reject(new Error("notification wait timed out"));
      }, timeoutMs);
      const check = () => {
        const match = this.notifications.find(predicate);
        if (!match) return;
        clearTimeout(timer);
        this.waiters.delete(check);
        resolve(match);
      };
      this.waiters.add(check);
    });
  }

  close(): void {
    this.process.kill("SIGTERM");
  }

  private write(message: Message): void {
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }
}

function isAgentMessage(message: Message): boolean {
  return message.method === "item/completed" && nestedString(message.params ?? {}, "item", "type") === "agentMessage";
}

function isMcpCall(message: Message): boolean {
  if (!message.method?.includes("mcpToolCall") && message.method !== "item/completed") return false;
  return message.method.includes("mcpToolCall") || nestedString(message.params ?? {}, "item", "type") === "mcpToolCall";
}

function nestedString(value: Record<string, unknown>, key: string, nested: string): string {
  const parent = value[key];
  if (!parent || typeof parent !== "object") return "";
  const result = (parent as Record<string, unknown>)[nested];
  return typeof result === "string" ? result : "";
}
