# pi-workflow Agent Instructions

## Validate

Run `npm run check` before handoff or commit. Use individual `package.json` scripts only for focused diagnosis.

## Repository goal

`pi-workflow` is a small, dependency-light Pi extension for code-first project workflows under `.pi/workflows/<name>/`.

## Context pointers

- **Workflow authoring:** before generating or editing a workflow, child prompt, authoring guide, or schema, read `agent_docs/workflow-authoring.md`; it owns task hierarchy, context budgets, cache layout, minimal schemas, and runbook constraints.
- **Interactive Pi testing:** before manually exercising the TUI, read the tmux procedure in `agent_docs/pi-agent-harness.md`.
- **Topic rules and repository map:** use `agent_docs/INDEX.md` to locate the guide for the active branch; load that guide rather than every topic.

## Architecture

- Parse and normalize at CLI, IO, API, and config boundaries; keep core logic strict.
- Keep Pi command/TUI wiring in `extensions/`, orchestration in `src/`, display rendering in `src/display/`, and raw prompt text in `src/prompts/`.
- Inject agents and external services; never hardcode providers in business logic.
- Prefer direct functions and existing helpers over managers, inheritance, or premature abstractions.
- Keep workflow phases as progress markers. Pass required results explicitly between stages.

## Code quality

- Read files in full before broad changes or editing unfamiliar files.
- Keep TypeScript strict and erasable under Node strip-only mode. Use top-level imports and avoid `any`.
- Check installed external API types instead of guessing.
- Inline single-use helpers that only rename an expression.
- Ask before removing intentional functionality. Preserve backward compatibility only when requested.
- Put configurable key defaults in `DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS` instead of hardcoding key checks.
- Add or update deterministic tests for behavior changes; tests use fake agents, never live models.
- Synchronize behavior changes with `README.md`, `docs/`, and the relevant agent guide.

## Communication

- Answer questions before editing.
- State agreement or disagreement before acting on feedback.
- Use concise technical prose. Avoid fluff and emojis in code, commits, issues, and PR comments.
