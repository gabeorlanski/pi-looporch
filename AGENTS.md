# pi-workflow Agent Instructions

## Commands

Run before handing off or committing:

```bash
npm run check
```

Focused commands:

```bash
npm run lint          # strict ESLint, zero warnings
npm run lint:fix      # auto-fix lint violations
npm run format        # Prettier write
npm run format:check  # Prettier check
npm run typecheck     # TypeScript without emit
npm test              # deterministic node:test suite
npm run loadcheck     # verify pi can load the extension
npm run precommit     # run lint-staged pre-commit actions
npm run pack:dry      # inspect published package contents
```

## Repository goal

`pi-workflow` is a small pi extension that lets projects run, review, and generate code-first workflows. Workflows live under `.pi/workflows/<name>/workflow.js` and use simple orchestration primitives such as `agent`, `parallel`, `pipeline`, `coerce`, `mapreduce`, `verifier`, `phase`, `log`, `args`, `cwd`, `budget`, `readText`, `readJson`, and `renderPrompt`.

## Documentation standard

Keep these in sync with every behavior or convention change:

- `README.md`: user-facing install, usage, and examples.
- `docs/`: design specs and durable product/architecture decisions.
- `agent_docs/`: concise coding rules learned from user guidance.
- Every relevant `AGENTS.md`: instructions agents need before editing that area.

When the user gives coding guidance or pushes back on code, add a rule to `agent_docs/INDEX.md` only if it is a generalizable coding pattern. Do not record one-off preferences, task-specific notes, or stale workarounds.

## Code organization

- `extensions/`: pi command, tool, and TUI wiring. Parse/coerce user input here.
- `src/`: testable workflow orchestration logic. Accept normalized inputs here.
- `src/display/`: every TUI or visible text renderer lives in a focused display module.
- `src/authoring-guide.ts`: generated workflow source guidance rendered into prompt templates.
- `src/prompts/`: raw prompt text files only; TypeScript interpolation lives outside this directory.
- `tests/`: deterministic `node:test` coverage with fake agents only.
- `docs/specs/`: workflow system design notes.
- `agent_docs/INDEX.md`: agent-facing coding rules and repository map.

## Key data shapes

TypeScript interfaces/types are the source of truth:

- `src/runtime.ts`: `WorkflowMetadata`, `WorkflowAgentOptions`, `WorkflowAgent`, `WorkflowSnapshot`, `RunWorkflowOptions`, `WorkflowRunResult`.
- `src/request.ts`: `WorkflowSelection`, `GeneratedWorkflowDraft`, `WorkflowReviewer`, `ResolveWorkflowRequestOptions`, `ResolvedWorkflowRequest`.
- `src/discovery.ts`: `WorkflowReference`.
- `src/tools.ts`: `WorkflowToolsOptions`.
- `src/pi-agent.ts`: `PiWorkflowAgentOptions`.

## Coding standards

- Keep the extension small and dependency-light.
- Keep command/UI parsing at boundaries; keep core runtime strict.
- Keep prompt copy in raw `.txt` files under `src/prompts/`.
- Keep generated workflow authoring guidance in TypeScript and inject it into raw prompts through placeholders.
- Keep workflow-local file reads in `readText`/`readJson`; use `renderPrompt` for prompt templates under the workflow's sibling `<workflow-name>.prompts/` directory.
- Agent-generated workflow source must start with JSDoc documenting purpose, args, phases, child agent usage, file reads, and result shape.
- Give every function a clear job; inline short helpers that only hide one expression or rename a local concept.
- Prefer simple functions over managers, frameworks, or class hierarchies.
- Inject agents/reviewers; never call real models from tests.
- Use deterministic fake agents in tests.
- Keep strict ESLint and Prettier clean; Husky runs lint-staged on pre-commit.
- Add or update tests with behavior changes.
- Update `README.md`, `docs/`, `agent_docs/`, and relevant `AGENTS.md` in the same change when guidance or behavior shifts.
