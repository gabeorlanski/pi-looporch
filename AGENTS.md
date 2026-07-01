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
