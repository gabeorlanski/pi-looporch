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

`pi-workflow` is a small pi extension that lets projects run, review, and generate code-first workflows. Workflows live under `.pi/workflows/<name>/workflow.js` and use simple orchestration primitives such as `agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, `cwd`, `budget`, `readText`, and `readJson`.

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
- `tests/`: deterministic `node:test` coverage with fake agents only.
- `docs/specs/`: workflow system design notes.
- `agent_docs/INDEX.md`: agent-facing coding rules and repository map.

## Key data shapes

TypeScript interfaces/types are the source of truth:

- `src/workflow-runtime.ts`: `WorkflowMetadata`, `WorkflowAgentOptions`, `WorkflowAgent`, `WorkflowSnapshot`, `RunWorkflowOptions`, `WorkflowRunResult`.
- `src/workflow-request.ts`: `WorkflowSelection`, `GeneratedWorkflowDraft`, `WorkflowReviewer`, `ResolveWorkflowRequestOptions`, `ResolvedWorkflowRequest`.
- `src/workflow-discovery.ts`: `WorkflowReference`.
- `src/workflow-tools.ts`: `WorkflowToolsOptions`.
- `src/pi-agent.ts`: `PiWorkflowAgentOptions`.

## Coding standards

- Keep the extension small and dependency-light.
- Keep command/UI parsing at boundaries; keep core runtime strict.
- Prefer simple functions over managers, frameworks, or class hierarchies.
- Inject agents/reviewers; never call real models from tests.
- Use deterministic fake agents in tests.
- Keep strict ESLint and Prettier clean; Husky runs lint-staged on pre-commit.
- Add or update tests with behavior changes.
- Update `README.md`, `docs/`, `agent_docs/`, and relevant `AGENTS.md` in the same change when guidance or behavior shifts.
