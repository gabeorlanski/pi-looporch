# pi-workflow Agent Instructions

## Commands

Run before handing off or committing:

```bash
npm run check
```

Useful focused checks:

```bash
npm run lint
npm run format:check
npm run docs:check
npm run typecheck
npm test
npm run loadcheck
```

## Repository Goal

`pi-workflow` is a small, dependency-light pi extension for code-first project
workflows. Workflows live under `.pi/workflows/<name>/workflow.js` and use
runtime primitives such as `agent`, `parallel`, `phase`, file helpers, and
`renderPrompt`.

## Documentation Scope

Keep this root `AGENTS.md` limited to durable, repo-wide guidance. Do not add
feature-specific behavior details, implementation notes, or test recipes here.
Put those in `docs/`, `agent_docs/`, or a narrower `AGENTS.md`.

Keep documentation synchronized with behavior changes:

- `README.md`: concise user-facing front door.
- `docs/`: design specs and product/architecture decisions.
- `agent_docs/`: concise agent-facing coding rules and repository map.
- Narrow `AGENTS.md` files: directory-local editing instructions.

When user guidance is generalizable, add it to `agent_docs/INDEX.md`. Do not
record one-off preferences or stale workarounds.

## Architecture

- Parse and normalize at boundaries: commands, tools, UI handlers, and config.
- Keep core runtime logic strict and already-normalized.
- Keep pi command/TUI wiring in `extensions/`; keep workflow orchestration in
  `src/`.
- Put display rendering in `src/display/` and raw prompt text in
  `src/prompts/`.
- Inject agents and external services; do not hardcode providers in core logic.
- Prefer direct functions and existing local helpers over new abstractions.

## Workflow Model

Keep the user-facing model simple:

```text
user asks for workflow help
  -> use an existing workflow or author a new one
  -> propose_workflow saves generated drafts
  -> run_workflow or /workflow runs saved workflows
```

Workflow phases are progress markers, not shared memory. If later work needs an
earlier result, pass that result explicitly through the workflow.

## Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text (e.g., "Thanks @user" not "Thanks so much @user!")
- Technical prose only, be direct
- When the user asks a question, answer it first before making edits or running implementation commands.
- When responding to user feedback or an analysis, explicitly say whether you agree or disagree before saying what you changed.

## Code Quality

- Read files in full before wide-ranging changes, before editing files you have not fully inspected, and when asked to investigate or audit. Do not rely on search snippets for broad changes.
- No `any` unless absolutely necessary.
- Inline single-line helpers that have only one call site.
- Check node_modules for external API types; don't guess.
- **No inline imports** (`await import()`, `import("pkg").Type`, dynamic type imports). Top-level imports only.
- Never remove or downgrade code to fix type errors from outdated deps; upgrade the dep instead.
- Use only erasable TypeScript syntax (Node strip-only mode) in code checked by the root config (`packages/*/src`, `packages/*/test`, `packages/coding-agent/examples`): no parameter properties, `enum`, `namespace`/`module`, `import =`, `export =`, or other constructs needing JS emit. Use explicit fields with constructor assignments.
- Always ask before removing functionality or code that appears intentional.
- Do not preserve backward compatibility unless the user asks for it.
- Never hardcode key checks (e.g. `matchesKey(keyData, "ctrl+x")`). Add defaults to `DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS` so they stay configurable.

## Testing pi Interactive Mode with tmux

Run the TUI in a controlled terminal (from the repo root):

```bash
tmux new-session -d -s pi-test -x 80 -y 24
tmux send-keys -t pi-test "./pi-test.sh" Enter
sleep 3 && tmux capture-pane -t pi-test -p     # capture after startup
tmux send-keys -t pi-test "your prompt here" Enter
tmux send-keys -t pi-test Escape               # special keys (also C-o for ctrl+o, etc.)
tmux kill-session -t pi-test
```

## Changelog

Location: `packages/*/CHANGELOG.md` (one per package).

Sections under `## [Unreleased]`: `### Breaking Changes` (API changes requiring migration), `### Added`, `### Changed`, `### Fixed`, `### Removed`.

Rules:

- All new entries go under `## [Unreleased]`. Read the full section first and append to existing subsections; never duplicate them.
- Released version sections (e.g. `## [0.12.2]`) are immutable; never modify them.

Attribution:

- Internal (from issues): `Fixed foo bar ([#123](https://github.com/gabeorlanski/pi-looporch/issues/123))`
- External contributions: `Added feature X ([#456](https://github.com/gabeorlanski/pi-looporch/pull/456) by [@username](https://github.com/username))`

## Coding Standards

- Keep the extension small and dependency-light.
- Keep generated workflow drafts outside the project by default.
- Keep child-agent prompts self-contained and source-of-truth oriented.
- Keep structured JSON compact: status, decisions, IDs, counts, paths, and short
  summaries; put large artifacts in files.
- Use deterministic fake agents in tests; never call real models from tests.
- Add or update tests for behavior changes.
- Keep strict ESLint, Prettier, docs checks, and TypeScript clean.

For detailed patterns, read `agent_docs/INDEX.md` before changing conventions.
