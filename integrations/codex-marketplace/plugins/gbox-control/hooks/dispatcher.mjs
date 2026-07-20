#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

import { shouldForwardStop, stableStopPayload } from "./policy.mjs";

const hookKind = process.argv[2];

try {
  const input = JSON.parse(await readStdin());
  const discovery = await readDiscovery();
  if (hookKind === "stop" && !(await observationEnabled(discovery))) {
    writeJson({ continue: true });
  } else {
    const route = routeFor(hookKind);
    const response = await fetch(`${discovery.endpoint}${route}`, {
      method: "POST",
      headers: requestHeaders(discovery),
      body: JSON.stringify(hookKind === "stop" ? stableStopPayload(input) : input),
      signal: AbortSignal.timeout(hookKind === "pre-tool-use" ? 305_000 : 15_000),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `gBox returned ${response.status}`);
    writeHookResult(hookKind, body);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "gBox is unreachable";
  if (hookKind === "pre-tool-use") {
    writeJson({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Protected action denied: ${message}`,
      },
    });
  } else if (hookKind === "stop") {
    writeJson({ continue: true, systemMessage: `gBox observation unavailable: ${message}` });
  } else {
    writeJson({ systemMessage: `gBox execution reporting unavailable: ${message}` });
  }
}

function writeHookResult(kind, body) {
  if (kind === "pre-tool-use") {
    const output = {
      hookEventName: "PreToolUse",
      permissionDecision: body.decision === "allow" ? "allow" : "deny",
      permissionDecisionReason: body.reason,
    };
    if (body.updatedInput) output.updatedInput = body.updatedInput;
    writeJson({ hookSpecificOutput: output });
    return;
  }
  if (kind === "stop") writeJson({ continue: true });
}

function routeFor(kind) {
  if (kind === "pre-tool-use") return "/hooks/pre-tool-use";
  if (kind === "post-tool-use") return "/hooks/post-tool-use";
  if (kind === "stop") return "/hooks/stop";
  throw new Error(`Unsupported gBox hook: ${kind}`);
}

async function observationEnabled(discovery) {
  const response = await fetch(`${discovery.endpoint}/status`, {
    headers: requestHeaders(discovery),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`gBox status returned ${response.status}`);
  const status = await response.json();
  return shouldForwardStop(status);
}

function requestHeaders(discovery) {
  return {
    authorization: `Bearer ${discovery.bearerToken}`,
    "content-type": "application/json",
  };
}

async function readDiscovery() {
  const directory = process.env.GBOX_APP_DATA_DIR ?? join(
    homedir(),
    "Library",
    "Application Support",
    "xyz.mcxross.gbox",
  );
  const discovery = JSON.parse(await readFile(join(directory, "hook-endpoint.json"), "utf8"));
  const url = new URL(discovery.endpoint);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error("gBox discovery endpoint is not loopback-only");
  }
  return discovery;
}

async function readStdin() {
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
