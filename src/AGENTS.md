# src/ Agent Instructions

## Commands

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run check
```

## Purpose

`src/` contains testable workflow orchestration logic for the pi extension. It should not contain pi command/TUI wiring.

## Rules

- Accept normalized inputs; do parsing/coercion in `extensions/` or tool boundaries.
- Keep runtime logic strict and explicit; throw `Error` with actionable messages.
- Inject `WorkflowAgent` and reviewers; never hardcode pi/model providers.
- Keep helpers small but not fragmented; inline functions that only obscure flow.
- Preserve workflow sandbox constraints: workflow file reads must stay inside the workflow directory.
- Update tests and docs when exported behavior or workflow primitives change.

## Key types

- `workflow-runtime.ts`: `WorkflowMetadata`, `WorkflowAgentOptions`, `WorkflowAgent`, `WorkflowSnapshot`, `RunWorkflowOptions`, `WorkflowRunResult`.
- `workflow-request.ts`: `WorkflowSelection`, `GeneratedWorkflowDraft`, `WorkflowReviewer`, `ResolvedWorkflowRequest`.
- `workflow-discovery.ts`: `WorkflowReference`.
- `workflow-tools.ts`: `WorkflowToolsOptions`.
- `pi-agent.ts`: `PiWorkflowAgentOptions`.

See `../agent_docs/INDEX.md` before changing patterns.
