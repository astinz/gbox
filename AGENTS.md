# Repository Agent Rules

## Scope

These rules apply to the entire repository.

## File Size

- Every human-authored source code file created or modified in this repository must remain below 1,000 lines. The maximum permitted length is 999 lines, including comments and blank lines.
- The limit applies to application code, tests, scripts, and other files containing code maintained by this project.
- The limit does not apply to generated build output, dependency lockfiles such as `package-lock.json`, generated code, vendored third-party code, binary assets, or tool-managed metadata.
- Check source file length before finishing a change. If a source file approaches the limit, split it into focused modules instead of compressing or obscuring the code.
- Do not create "god files" that combine unrelated source-code responsibilities, even when they are below the line limit.

## Separation of Concerns

- Give each module, component, service, hook, command, and configuration file one clear responsibility.
- Keep user-interface code, application logic, domain logic, persistence, and external integrations in separate modules.
- Prefer small, cohesive modules with explicit interfaces over catch-all helpers or broad `utils` files.
- Place shared code in a dedicated module only when it has a well-defined purpose and is genuinely reused.
- Keep tests focused on the behavior of the corresponding module. Split large test suites by feature or behavior.

## Languages and Formatting

- This repository uses Rust and TypeScript. Do not add Go source files, `gofmt`-specific files, or generated `gofmt` artifacts.
- Format Rust with `cargo fmt`/`rustfmt` and follow the project's TypeScript formatting and linting configuration.
- Preserve existing naming conventions and directory boundaries when adding new code.

## UI and Copy

- Write all user-facing interfaces for executives and end users, not for engineers building gBox.
- Describe outcomes, decisions, evidence, and next steps in plain language.
- Never expose internal engine mechanics in product copy, including Codex turns, hooks, pipelines, execution loops, App Server events, JSONL, workers, queues, or internal service names.
- Keep implementation terminology in source code, tests, logs, and developer documentation only. Translate it before presenting status or errors in the interface.
- Prefer concise labels such as “Research complete,” “Checking evidence,” and “Needs review” over protocol or subsystem names.
- Avoid generic AI-product styling and copy: no vague slogans, ornamental status clutter, excessive cards or pills, decorative gradients, or features presented without a clear user decision or outcome.

## Completion Check

Before completing a change:

1. Confirm that every created or modified human-authored source code file is fewer than 1,000 lines.
2. Confirm that no source file has become a god file or mixes unrelated concerns.
3. Confirm that no Go or `gofmt` files were introduced.
4. Run the relevant formatter, checks, and tests when available.
