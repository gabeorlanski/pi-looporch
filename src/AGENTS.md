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
- Put TUI and visible text rendering in `display/`, one display concern per file.
- Put raw prompt text in `prompts/*.txt`; keep interpolation code outside `prompts/`.
- Keep generated workflow authoring docs in `authoring-guide.ts`; render them into prompts through placeholders.
- Require generated workflow source to start with JSDoc documenting args, phases, child agents, file reads, and result shape.
- Keep helpers purposeful; inline short functions that only obscure flow.
- Preserve workflow sandbox constraints: workflow file reads must stay inside the workflow directory.
- Update tests and docs when exported behavior or workflow primitives change.

## Key types

- `runtime.ts`: `WorkflowMetadata`, `WorkflowAgentOptions`, `WorkflowAgent`, `WorkflowSnapshot`, `RunWorkflowOptions`, `WorkflowRunResult`.
- `request.ts`: `WorkflowSelection`, `GeneratedWorkflowDraft`, `WorkflowReviewer`, `ResolvedWorkflowRequest`.
- `discovery.ts`: `WorkflowReference`.
- `tools.ts`: `WorkflowToolsOptions`.
- `pi-agent.ts`: `PiWorkflowAgentOptions`.
- `authoring-guide.ts`: rendered workflow source guidance injected into prompt templates.
- `display/`: progress, approval, and boundary message rendering.
- `prompts/`: raw prompt templates loaded by `prompt-templates.ts`.

See `../agent_docs/INDEX.md` before changing patterns.
