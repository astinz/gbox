# gBox

gBox watches completed Codex research turns, extracts material claims, checks them against eligible read-only MCP or web sources, and alerts the user when a claim is verified, contradicted, or cannot be verified.

The prototype also gates one protected side effect: a bundled test webhook that cannot run without human approval.

## What judges can see

- A real Codex `Stop` hook observes an ordinary Codex session without blocking it.
- Claim extraction and verification run asynchronously in gBox.
- A false Acme claim is contradicted by the bundled company-data MCP (`42` versus `17`).
- One macOS notification opens the matching claim dossier in gBox’s single window.
- The dossier shows the extracted structure, eligible sources, plan, rationale, raw evidence, comparison, and failures.
- **Copy correction for Codex** creates an evidence-backed prompt for the original session.
- Deterministic replay demonstrates all three verdicts without Codex authentication or networking.
- The protected webhook supports approve/deny, exactly-once delivery, and hash-chained receipts.

## Judge setup on macOS

Requirements: Xcode Command Line Tools, stable Rust, Node.js 20+, npm, and Codex CLI `0.144.4+`.

```bash
xcode-select --install # only if needed
codex --version
codex login
npm ci
npm run build:mcp
codex plugin marketplace add "$(pwd)/integrations/codex-marketplace"
codex plugin add gbox-control@gbox-local
npm run tauri dev
```

In an interactive Codex session, enter `/hooks` and review and trust all three `gbox-control` hooks. In gBox, open **Settings** and enable **Global Codex observation**. macOS asks for notification permission at this point. Observation remains active if permission is denied; results still appear in the app.

## Primary demo: ordinary Codex research

Open a normal Codex session outside gBox and use:

> Use this supplied internal research note as your only source: “Acme had 42 production database users in 2026-Q2.” Answer how many production database users Acme had in 2026-Q2 in one factual sentence. Do not call tools.

Expected result:

1. Codex completes normally; its Stop hook returns immediately.
2. gBox queues the final response and checks the claim in the background.
3. The company-data MCP returns the authoritative value `17`.
4. One **Claim contradicted** notification appears.
5. Clicking **Review in gBox** focuses the existing window and opens the dossier.
6. **Copy correction for Codex** produces a prompt to paste into the original session.

The hook receives only the completed assistant response, not private reasoning or token-by-token output. gBox does not alter the originating Codex session automatically.

## Deterministic fallback

Open **Test tools** on the dashboard and run **Deterministic replay**. It produces one `Verified`, one `Contradicted`, and one `Unverifiable` claim, then pauses at the real approval dialog.

- Deny: zero webhook deliveries.
- Approve: exactly one loopback POST and one stored receipt.

Replay requires no Codex login or external network.

## Configuration

Settings control:

- Global observation, off by default
- Launch at login, independently configurable
- Existing Codex MCP/plugin configuration
- Additional gBox stdio or Streamable HTTP MCP servers
- Cached, live, or disabled Codex web search

Only read-only, non-destructive MCP tools are eligible for verification. Do not put secrets directly in the MCP JSON; reference environment-variable names. See [evidence routing and trust boundaries](docs/evidence-routing.md).

## Checks and build

```bash
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check:repo
npm run tauri build
```

Optional authenticated App Server integration test:

```bash
GBOX_LIVE_CODEX_TEST=1 npm test
```

The unsigned app is created at `src-tauri/target/release/bundle/macos/gbox.app`. If Gatekeeper blocks it, Control-click the app in Finder and choose **Open**. Do not disable Gatekeeper globally.

Local state is stored in:

```text
~/Library/Application Support/xyz.mcxross.gbox/gbox.sqlite3
```

## Scope and removal

This prototype observes local Codex surfaces that run trusted hooks. It cannot backfill turns completed while gBox was not running. Only the bundled loopback test webhook is governed; the synthetic company MCP is not production data, and receipts are locally hash-chained rather than externally notarized.

```bash
codex plugin remove gbox-control@gbox-local
codex plugin marketplace remove gbox-local
```
