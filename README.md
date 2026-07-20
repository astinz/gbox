# gBox

gBox is a macOS-first evidence and human-control layer for Codex. It hosts real Codex App Server sessions, extracts company-metric claims, verifies them against a deterministic MCP source, and stops a protected test webhook until a person explicitly approves or denies it.

This is a minimum credible implementation, not a general-purpose agent firewall. In v1, only the bundled `gbox_send_test_webhook` MCP tool is governed. Company records are synthetic, the sink is fixed to loopback, and receipts are locally hash-chained rather than externally notarized.

## What works

- Real `codex app-server --stdio` supervision with JSONL request correlation, genuine streamed events, clean child shutdown, `thread/start`, `turn/start`, and same-turn `turn/steer`.
- Strict claim extraction in an ephemeral read-only Codex thread, followed by deterministic decimal comparison against `company_get_metric`.
- `Verified`, `Contradicted`, and `Unverifiable` claim states with stored MCP evidence hashes.
- A fail-closed Codex plugin hook that holds `gbox_send_test_webhook` for up to five minutes and rewrites the tool input only after approval.
- Payload-bound, action-bound, five-minute, single-use approval tokens and exactly-once delivery to a fixed `127.0.0.1` sink.
- SQLite persistence for sessions, events, claims, evidence, actions, decisions, permits, deliveries, and SHA-256 hash-chained receipts.
- A separate always-on-top approval window and an offline deterministic replay using the real gate, sink, persistence, and receipt path.

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

## Deterministic replay

Choose **Run deterministic replay** in the app. Replay:

1. Resets demo-domain rows while preserving settings.
2. Feeds one verified, one contradicted, and one unverifiable synthetic claim through the same verifier and frontend event pipeline.
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

`npm test` builds and spawns the MCP server over stdio, verifies strict input handling and fail-closed webhook behavior, and tests the claim ledger, status consent, replay control, and approval panel. Rust tests cover all three verdicts, semantic deduplication, payload/action binding, permit expiry, replay prevention, exactly-once delivery, persistence across restart, receipt contents, and tamper detection.

After installing and trusting the plugin, opt into the authenticated live integration test with `GBOX_LIVE_CODEX_TEST=1 npm test`. It starts the installed App Server and asserts genuine thread, turn, assistant-message, and MCP tool-call notifications. The test is skipped by default so normal CI and replay remain authentication-free.

## Architecture

```text
Codex App Server (JSONL) ──> Rust supervisor ──> normalized events ──> React timeline
             │                     │
             │               isolated extractor
             │                     │
             └── company MCP <── deterministic verifier ──> claim/evidence ledger

ordinary Codex ──> trusted PreToolUse hook ──> loopback control service
                                                   │
                                           approval window
                                                   │ permit
protected MCP webhook ─────────────────────────────┴──> fixed loopback sink
                                                               │
                                                        SQLite + receipts
```

Responsibilities remain separated across protocol supervision, verification, persistence, action gating, control HTTP, Tauri commands, MCP tools, hook dispatch, and React presentation. Human-authored source files are checked to remain below 1,000 lines, and the repository contains no Go or `gofmt` artifacts.
