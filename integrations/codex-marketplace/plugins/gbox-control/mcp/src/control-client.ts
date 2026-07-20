import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod/v4";

const discoverySchema = z.object({
  endpoint: z.string().url(),
  bearerToken: z.string().min(32),
  pid: z.number().int().positive(),
  version: z.string().min(1),
});

export type WebhookInput = {
  report_markdown: string;
  event_type: string;
  approval_token: string;
  gbox_action_id: string;
};

export async function sendGovernedWebhook(input: WebhookInput): Promise<unknown> {
  const discovery = discoverySchema.parse(
    JSON.parse(await readFile(discoveryPath(), "utf8")),
  );
  assertLoopback(discovery.endpoint);
  const response = await fetch(`${discovery.endpoint}/webhook-sink`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${discovery.bearerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(`gBox rejected the protected webhook (${response.status})`);
  }
  return body;
}

function discoveryPath(): string {
  if (process.env.GBOX_APP_DATA_DIR) {
    return join(process.env.GBOX_APP_DATA_DIR, "hook-endpoint.json");
  }
  return join(
    homedir(),
    "Library",
    "Application Support",
    "xyz.mcxross.gbox",
    "hook-endpoint.json",
  );
}

function assertLoopback(endpoint: string): void {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error("gBox discovery endpoint is not a loopback HTTP address");
  }
}
