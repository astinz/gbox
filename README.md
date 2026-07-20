# gBox

gBox is a macOS-first evidence and human-control layer for Codex. It hosts real Codex App Server sessions, extracts arbitrary factual claims, chooses an eligible read-only evidence source, and stops a protected test webhook until a person explicitly approves or denies it.

This is a minimum credible implementation, not a general-purpose agent firewall. In v1, only the bundled `gbox_send_test_webhook` MCP tool is governed. Company records are synthetic, web results remain untrusted, the webhook sink is fixed to loopback, and receipts are locally hash-chained rather than externally notarized.

## What works

- Real `codex app-server --stdio` supervision with JSONL request correlation, genuine streamed events, clean child shutdown, `thread/start`, `turn/start`, and same-turn `turn/steer`.
- Domain-neutral claim extraction in an ephemeral, read-only, tools-disabled Codex thread. Claims are normalized into subject, predicate, object, asserted value, unit, time, location, and exact source span.
- Evidence discovery through stable `mcpServerStatus/list`, including pagination and full MCP tool metadata.
- A constrained source planner that can choose one eligible MCP tool, Codex web search, or no source. Write-capable and ambiguously annotated MCP tools are excluded.
- Configurable stdio and Streamable HTTP MCP servers, plus an option to include the MCP and plugin configuration already available to Codex.
- `Verified`, `Contradicted`, and `Unverifiable` states with stored source-selection rationale, evidence content, source references, and structured-result hashes.
- Deterministic decimal comparison for evidence matching the bundled company-metric contract. Other MCP and web evidence is evaluated by an isolated strict-schema Codex thread with no shell or MCP tools.
- A fail-closed Codex plugin hook that holds `gbox_send_test_webhook` for up to five minutes and rewrites the tool input only after approval.
- Payload-bound, action-bound, five-minute, single-use approval tokens and exactly-once delivery to a fixed `127.0.0.1` sink.
- SQLite persistence for sessions, events, generic claims, evidence, settings, actions, decisions, permits, deliveries, and SHA-256 hash-chained receipts.
- A separate always-on-top approval window and an offline deterministic replay using the real gate, sink, persistence, and receipt path.

gBox does not use experimental dynamic tools. The implementation uses the stable App Server thread, turn, MCP status, MCP call, and streamed-item interfaces available in Codex CLI `0.144.4`.

## How evidence routing works

```text
assistant text
    │
    ▼
isolated claim extractor ──> normalized arbitrary claim
                                  │
                                  ▼
                         eligible-source catalog
                         ┌────────┼─────────┐
                         │        │         │
                  read-only MCP  web     no source
                         │      search       │
                         └────────┼─────────┘
                                  ▼
                    deterministic adapter or
                    isolated evidence evaluator
                                  │
                                  ▼
                 claim verdict + evidence + receipt
```

Plugins are not a third transport. A Codex plugin can contribute MCP servers, hooks, and skills; plugin-provided verification tools therefore enter the catalog through MCP and are recorded as `plugin_mcp` when their provenance is available. gBox does not execute skills as evidence sources.

Only MCP tools with `readOnlyHint: true` and without `destructiveHint: true` are eligible. Tool annotations are claims made by the MCP server, so only configure servers you trust. Protected side effects remain on the separate human-approval path and are never eligible verification sources.

See [Evidence routing and trust boundaries](docs/evidence-routing.md) for the complete decision policy and limitations.

## macOS prerequisites

Install:

- Xcode Command Line Tools: `xcode-select --install`
- Stable Rust through [rustup](https://rustup.rs/)
- Node.js 20 or newer and npm
- Codex CLI `0.144.4` or newer

Confirm the tools and authenticate Codex:

```bash
rustc --version
node --version
npm --version
codex --version
codex login
```

gBox uses the existing Codex login. Replay mode does not require a Codex login or external network access.

## Install and run

From this repository:

```bash
npm ci
npm run build:mcp
npm run tauri dev
```

The first live task starts App Server. Hosted sessions always use Codex's read-only sandbox and route no approval requests from Codex itself; the gBox webhook still requires its own explicit human decision.

Local state is stored at:

```text
~/Library/Application Support/xyz.mcxross.gbox/gbox.sqlite3
```

The loopback endpoint, process ID, and rotating bearer token are written with user-only permissions to `hook-endpoint.json` beside the database. The service rejects unauthenticated requests and request bodies over 64 KB.

## Configure evidence sources

Open **Evidence sources** in gBox.

- **Use existing Codex MCP configuration** includes the MCP servers and plugin-provided MCP tools already available to the current Codex installation. It is enabled by default, so the bundled company test MCP is immediately eligible after plugin installation.
- Turning inheritance off limits gBox routing to the enabled servers in its own JSON configuration. gBox also sends per-thread disable overrides for discovered inherited MCP servers.
- **Web-search policy** supports `disabled`, `cached`, and `live`. Cached is the safer default. Live mode is useful for current events but increases exposure to untrusted, prompt-injection-bearing web content.
- **gBox-specific MCP servers** accepts a bounded JSON array using Codex's supported stdio or Streamable HTTP configuration fields.

Stdio example:

```json
[
  {
    "name": "internal_facts",
    "enabled": true,
    "transport": "stdio",
    "command": "/absolute/path/to/internal-facts-mcp",
    "args": [],
    "cwd": "/absolute/path/to/server",
    "envVars": ["INTERNAL_FACTS_TOKEN"]
  }
]
```

Streamable HTTP example:

```json
[
  {
    "name": "official_records",
    "enabled": true,
    "transport": "http",
    "url": "https://records.example.com/mcp",
    "bearerTokenEnvVar": "OFFICIAL_RECORDS_TOKEN"
  }
]
```

Do not place secret values in gBox JSON. Use `envVars` to forward named environment variables to stdio servers and `bearerTokenEnvVar` for HTTP bearer authentication. Embedded URL credentials, invalid names, duplicate servers, and oversized configurations are rejected.

## Install the Codex plugin

Build the MCP bundle before installing the repository-local marketplace:

```bash
npm run build:mcp
codex plugin marketplace add "$(pwd)/integrations/codex-marketplace"
codex plugin add gbox-control@gbox-local
```

Start an interactive Codex session and enter `/hooks`. Review and trust the three `gbox-control` command hooks. Trust is intentionally a human step: Codex stores trust against the exact hook hash and requires another review after it changes.

With gBox running, ask ordinary Codex to use `gbox_send_test_webhook`. The `PreToolUse` hook waits for the gBox approval window. Denial, timeout, invalid input, a missing gBox process, or an invalid permit prevents delivery. The `PostToolUse` hook reports the execution result. The `Stop` hook forwards final assistant text only when **Global Codex observation** is visibly enabled in gBox.

Remove the integration with:

```bash
codex plugin remove gbox-control@gbox-local
codex plugin marketplace remove gbox-local
```

## Test the false-claim path

The hosted-task composer starts with this scenario:

> Evaluate this intentionally false claim: “Acme had 42 production database users in 2026-Q2.” Use the available company metric MCP to check it, clearly state the contradiction, and prepare a concise report for the gBox test webhook. Do not send it without human approval.

With the plugin installed and Codex MCP inheritance enabled, the task invokes `company_get_metric`, receives the authoritative value `17`, records a `Contradicted` claim, and pauses the protected webhook for approval.

## Deterministic replay

Choose **Run deterministic replay** in the app. Replay:

1. Resets demo-domain rows while preserving settings.
2. Feeds one verified, one contradicted, and one unverifiable synthetic claim through the same generic claim ledger and deterministic company evidence adapter.
3. Opens the real approval window at the protected webhook.
4. On approval, consumes a real single-use permit, records exactly one loopback delivery, and appends a receipt. Denial creates no delivery.

Replayed upstream events carry a visible `replayed` label. If replay will not start, resolve the existing pending approval first. If the approval window was hidden behind another application, activate gBox from the Dock; the approval window is always-on-top once shown.

## Build an unsigned app

```bash
npm run tauri build
open src-tauri/target/release/bundle/macos/gbox.app
```

The app is intentionally unsigned. If macOS blocks it, Control-click the app in Finder, choose **Open**, then confirm **Open**. This creates an exception for this app without disabling Gatekeeper globally.

## Verification

Run the required checks:

```bash
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check:repo
npm run tauri build
```

`npm test` builds and spawns the MCP server over stdio, verifies strict input handling and fail-closed webhook behavior, and tests the generic claim ledger, evidence settings, status consent, replay control, and approval panel. Rust tests cover source filtering, configuration validation, all three verdicts, semantic deduplication, payload/action binding, permit expiry, replay prevention, exactly-once delivery, persistence, receipt contents, and tamper detection.

After installing and trusting the plugin, opt into the authenticated live integration test with:

```bash
GBOX_LIVE_CODEX_TEST=1 npm test
```

It starts the installed App Server with the false-claim prompt and asserts genuine thread, turn, assistant-message, and MCP tool-call notifications plus both the claimed value `42` and authoritative value `17`. The test is skipped by default so normal CI and replay remain authentication-free.

## Architecture

Responsibilities remain separated across protocol supervision, claim extraction, source policy, verification, persistence, action gating, control HTTP, Tauri commands, MCP tools, hook dispatch, and React presentation. Human-authored source files are checked to remain below 1,000 lines, and the repository contains no Go or `gofmt` artifacts.
