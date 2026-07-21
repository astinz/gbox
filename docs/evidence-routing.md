# Evidence routing and trust boundaries

## Pipeline

gBox separates four questions that are easy to conflate:

1. **What was claimed?** An isolated Codex thread extracts independently checkable assertions without tools.
2. **Which source can answer?** A second isolated thread selects one entry from a server-supplied, gBox-filtered source catalog.
3. **What did the source return?** gBox invokes the chosen read-only MCP tool directly through App Server, or runs a web-only verifier thread.
4. **What verdict follows?** A deterministic adapter compares known evidence schemas; otherwise a no-tools strict-schema evaluator compares the claim and evidence.

Each stage fails to `Unverifiable`. Extraction, planning, malformed evidence, source errors, timeouts, and missing records never silently become `Verified`.

## Source classes

### MCP

gBox discovers MCP inventory with stable `mcpServerStatus/list` calls and invokes tools with stable `mcpServer/tool/call` calls. It follows pagination and requests full tool metadata.

A tool is eligible only when its annotations say:

```json
{
  "readOnlyHint": true,
  "destructiveHint": false
}
```

A missing `destructiveHint` is accepted only when `readOnlyHint` is explicitly true. Any explicit destructive annotation excludes the tool. The planner receives no excluded tools.

MCP annotations are asserted by the server rather than independently enforced by the protocol. A malicious server can lie, so server configuration remains a trust decision. gBox's protected webhook is separately recognized as side-effecting and can never enter the evidence catalog.

### Plugins

A plugin is packaging and provenance, not an invocation transport. Plugins may bundle MCP servers, hooks, and skills. Plugin-provided MCP tools follow the same read-only eligibility policy and use the same App Server MCP call method. gBox records `plugin_mcp` provenance when App Server metadata or the bundled gBox integration identifies it.

Skills are instructions, not authoritative data endpoints. gBox does not treat installed skills as evidence sources.

### Web search

Web verification runs in a dedicated read-only Codex thread with MCP and shell tools disabled. The configured mode is:

- `disabled`: web is absent from the planner catalog.
- `cached`: use Codex's indexed cache; this is the default.
- `live`: fetch current web results.

The verifier is instructed to prefer primary official sources, cite inspected URLs, and ignore instructions found in pages. This reduces but cannot eliminate prompt-injection and source-quality risk. High-stakes actions should require stronger domain adapters or human review even when the model returns `Verified`.

## Configuration semantics

`useCodexMcpConfig: true` makes the existing Codex MCP and plugin inventory eligible. gBox-specific servers are overlaid on that configuration.

`useCodexMcpConfig: false` filters routing to enabled gBox-specific servers and sends per-thread disable overrides for inherited servers discovered from App Server. The source catalog is the final enforcement point: an inherited server that is not allowed never reaches the planner and is never called by gBox verification.

gBox-specific settings support:

- stdio: `command`, `args`, `cwd`, and forwarded `envVars` names;
- Streamable HTTP: `url` and `bearerTokenEnvVar`.

Secret values are intentionally not a supported field. Settings are persisted in local SQLite, so only environment-variable names belong in the configuration.

## Verdict semantics

- `Verified`: the selected evidence directly supports the complete claim.
- `Contradicted`: the selected evidence directly conflicts with the claim.
- `Unverifiable`: no suitable source, missing or ambiguous evidence, unsupported comparison, malformed output, source failure, timeout, or pipeline failure.

The bundled company adapter parses decimal strings with `rust_decimal`, checks subject, metric, period, and canonical unit, and never uses floating-point equality. This is deterministic.

Generic MCP and web evidence can have arbitrary schemas. Their verdicts are model-assisted and therefore probabili stic. gBox preserves the tool result, selection rationale, source reference, explanation, confidence, and SHA-256 result hash so a person can audit the decision. Future production integrations should add deterministic adapters for each authoritative domain contract.

## Action boundary

Evidence collection does not authorize action. Every protected webhook call requires an explicit human decision regardless of verdict. Approval tokens are random, payload-bound, action-bound, expire after five minutes, and are consumed once. Denial, timeout, an unreachable gBox service, or invalid evidence fails closed for the protected tool.

V1 does not claim to intercept shell, filesystem, browser, email, deployment, or arbitrary third-party MCP side effects. Expanding protection requires explicit adapters or hooks for those actions; observing a claim is not equivalent to controlling every consequence of that claim.
