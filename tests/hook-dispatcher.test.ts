// @vitest-environment node
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  shouldForwardStop,
  stableStopPayload,
} from "../integrations/codex-marketplace/plugins/gbox-control/hooks/policy.mjs";

const dispatcher = resolve(
  "integrations/codex-marketplace/plugins/gbox-control/hooks/dispatcher.mjs",
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("gBox hook dispatcher", () => {
  it("does not forward a final message while global observation is disabled", () => {
    expect(shouldForwardStop({ globalObservation: false })).toBe(false);
    expect(shouldForwardStop({ globalObservation: true })).toBe(true);
    expect(shouldForwardStop(undefined)).toBe(false);
  });

  it("denies the protected tool when gBox is unreachable", async () => {
    const directory = await discoveryDirectory("http://127.0.0.1:9");
    const result = await runHook("pre-tool-use", directory, {
      hook_event_name: "PreToolUse",
      tool_name: "mcp__company_data__gbox_send_test_webhook",
      tool_input: { report_markdown: "test" },
    });
    const output = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("forwards stable completed-turn fields without depending on transcript files", () => {
    const payload = stableStopPayload({
      session_id: "ordinary-codex-session",
      turn_id: "turn-8",
      cwd: "/tmp/research",
      transcript_path: "/unstable/transcript.jsonl",
      last_assistant_message: "Acme had 42 production database users.",
    });

    expect(payload).toEqual({
      session_id: "ordinary-codex-session",
      turn_id: "turn-8",
      cwd: "/tmp/research",
      last_assistant_message: "Acme had 42 production database users.",
    });
    expect(payload).not.toHaveProperty("transcript_path");
  });
});

async function discoveryDirectory(endpoint: string): Promise<string> {
  const directory = await mkdtemp(`${tmpdir()}/gbox-hook-test-`);
  temporaryDirectories.push(directory);
  await writeFile(
    `${directory}/hook-endpoint.json`,
    JSON.stringify({ endpoint, bearerToken: "t".repeat(64), pid: 1, version: "test" }),
  );
  return directory;
}

function runHook(kind: string, directory: string, input: unknown) {
  return new Promise<{ exitCode: number | null; stdout: string }>((resolveRun, reject) => {
    const child = spawn(process.execPath, [dispatcher, kind], {
      env: { ...process.env, GBOX_APP_DATA_DIR: directory },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (stderr) reject(new Error(stderr));
      else resolveRun({ exitCode, stdout: stdout.trim() });
    });
    child.stdin.end(JSON.stringify(input));
  });
}
