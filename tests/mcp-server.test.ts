// @vitest-environment node
import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";

const serverPath = resolve(
  "integrations/codex-marketplace/plugins/gbox-control/mcp/dist/index.mjs",
);
let transport: StdioClientTransport | undefined;

afterEach(async () => {
  await transport?.close();
  transport = undefined;
});

async function connectClient(): Promise<Client> {
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    stderr: "pipe",
  });
  const client = new Client({ name: "gbox-test", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

describe("company-data MCP server", () => {
  it("returns a structured authoritative metric", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "company_get_metric",
      arguments: {
        company_id: "acme",
        metric: "production_database_users",
        period: "2026-Q2",
      },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      record_id: "acme-prod-db-users-2026-q2",
      value: "17",
      unit: "count",
    });
  });

  it("reports missing records and rejects unknown input", async () => {
    const client = await connectClient();
    const missing = await client.callTool({
      name: "company_get_metric",
      arguments: {
        company_id: "acme",
        metric: "unknown_metric",
        period: "2026-Q2",
      },
    });
    const invalid = await client.callTool({
      name: "company_get_metric",
      arguments: {
        company_id: "acme",
        metric: "revenue",
        period: "2026-Q2",
        unsupported: true,
      },
    });

    expect(missing.isError).toBe(true);
    expect(invalid.isError).toBe(true);
  });

  it("fails closed when the protected tool has no approval permit", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "gbox_send_test_webhook",
      arguments: {
        report_markdown: "# Test report",
        event_type: "test_webhook",
      },
    });

    expect(result.isError).toBe(true);
  });
});
