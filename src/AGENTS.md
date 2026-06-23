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
- Require generated workflow source to document the default workflow function with JSDoc covering input fields/defaults, phases, child agents, file reads, and result shape.
- Generated workflow child-agent prompts must be self-contained expert task packets with source-of-truth paths, prior results, invariants, concrete operating instructions, evidence requirements, pass/fail gates, and exact artifacts to read or write.
- Keep helpers purposeful; inline short functions that only obscure flow.
- Preserve workflow sandbox constraints around ambient authority: workflows cannot import modules or use Node globals, `renderPrompt` must resolve only through the workflow's own `prompts/` directory, and `readText`/`readJson` may read absolute paths, project-cwd-relative paths, or `@workflow/...` paths.
- Keep `agent(prompt, { cwd })` as a launch option for alternate child-agent working directories; resolve relative values from the workflow project cwd.
- Encourage workflow authors to add `log(message)` for visible milestones and `trace(label, value?)` for structured handoff/debug data.
- Never estimate token counts; only report provider/session usage or zero/unknown when actual usage is unavailable.
- Update tests and docs when exported behavior or workflow primitives change.

## Key types

- `runtime-types.ts`: `WorkflowMetadata`, `WorkflowAgentOptions`, `WorkflowAgent`, `WorkflowSnapshot`, `RunWorkflowOptions`, `WorkflowRunResult`.
- `runtime.ts`: workflow execution wiring and public runtime re-exports.
- `workflow-paths.ts`: workflow name/path/cwd resolution.
- `workflow-sandbox.ts`: sandbox module transform and import/require bans.
- `workflow-metadata.ts`: static `export const metadata = { ... }` parsing.
- `request.ts`: `GeneratedWorkflowDraft`, `WorkflowReviewer`, review-gated draft saving.
- `discovery.ts`: `WorkflowReference`.
- `tools.ts`: `WorkflowToolsOptions`.
- `pi-agent.ts`: `PiWorkflowAgentOptions`.
- `authoring-guide.ts`: on-demand workflow primitive index/details returned by the `workflow_primitives` tool.
- `workflow-outline.ts`: `WorkflowOutline`, `OutlineSection`, `OutlineStage`, `OutlinePrompt`; static AST parse of `workflow.js` into phases/stages/prompts plus `indexOutline*` helpers for review tooling.
- `display/`: progress, approval, and boundary message rendering. `workflow-review.ts` (`flattenReviewNodes`/`renderWorkflowReview`/`buildChangeRequest`) is the testable model + renderer for the in-terminal TUI proposal review; `extensions/workflow.ts` wires its keys and comment editor. `agent-inspector.ts` renders the Ctrl+\ transcript-pane header; the transcript below it is loaded from the child agent session log and rendered with pi's native message components in `extensions/workflow.ts`.
- `prompts/`: raw prompt templates loaded by `prompt-templates.ts`.

See `../agent_docs/INDEX.md` before changing patterns.
