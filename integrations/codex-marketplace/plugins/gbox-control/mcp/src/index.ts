import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import { sendGovernedWebhook } from "./control-client.js";
import { findCompanyMetric } from "./records.js";

const metricOutput = z.strictObject({
  record_id: z.string(),
  company_id: z.string(),
  metric: z.string(),
  period: z.string(),
  value: z.string(),
  unit: z.string(),
  as_of: z.string(),
  source_system: z.string(),
  version: z.string(),
});

const webhookOutput = z.strictObject({
  ok: z.boolean(),
  action_id: z.string(),
  delivery: z.literal("loopback-webhook"),
  delivered_at: z.string().nullable(),
});

const server = new McpServer({
  name: "company-data-mcp-server",
  version: "0.1.0",
});

server.registerTool(
  "company_get_metric",
  {
    title: "Get authoritative company metric",
    description:
      "Read one seeded, synthetic company metric by company, metric, and reporting period.",
    inputSchema: z.strictObject({
      company_id: z.string().trim().min(1).max(80),
      metric: z.string().trim().min(1).max(100),
      period: z.string().trim().min(1).max(40),
    }),
    outputSchema: metricOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ company_id, metric, period }) => {
    const record = findCompanyMetric(company_id, metric, period);
    if (!record) {
      return toolError(
        `No authoritative record exists for ${company_id}/${metric}/${period}.`,
      );
    }
    const structuredContent = {
      record_id: record.recordId,
      company_id: record.companyId,
      metric: record.metric,
      period: record.period,
      value: record.value,
      unit: record.unit,
      as_of: record.asOf,
      source_system: record.sourceSystem,
      version: record.version,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
      structuredContent,
    };
  },
);

server.registerTool(
  "gbox_send_test_webhook",
  {
    title: "Send gBox-governed test webhook",
    description:
      "Send a bounded report to gBox's fixed loopback webhook sink. A gBox approval token is mandatory.",
    inputSchema: z.strictObject({
      report_markdown: z.string().trim().min(1).max(50_000),
      event_type: z.literal("test_webhook").default("test_webhook"),
      approval_token: z.string().min(32).optional(),
      gbox_action_id: z.string().uuid().optional(),
    }),
    outputSchema: webhookOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ report_markdown, event_type, approval_token, gbox_action_id }) => {
    if (!approval_token || !gbox_action_id) {
      return toolError("gBox approval is required before this webhook can run.");
    }
    try {
      const response = (await sendGovernedWebhook({
        report_markdown,
        event_type,
        approval_token,
        gbox_action_id,
      })) as {
        ok: boolean;
        actionId: string;
        delivery: "loopback-webhook";
        deliveredAt: string | null;
      };
      const structuredContent = {
        ok: response.ok,
        action_id: response.actionId,
        delivery: response.delivery,
        delivered_at: response.deliveredAt,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    } catch (error) {
      return toolError(error instanceof Error ? error.message : "Webhook delivery failed.");
    }
  },
);

function toolError(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

const transport = new StdioServerTransport();
await server.connect(transport);
