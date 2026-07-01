# src/ Agent Instructions

## Commands

```bash
npm run lint
npm run format:check
npm run docs:check
npm run typecheck
npm test
npm run check
```

## Purpose

`src/` contains testable workflow orchestration logic for the pi extension. It should not contain pi command/TUI wiring.

## Rules

- Accept normalized inputs; do parsing/coercion in `extensions/` or tool boundaries.
- Keep runtime logic strict and explicit; throw `Error` with actionable messages.
- Add concise JSDoc contracts to exported declarations in public API modules covered by `npm run docs:check`.
- Keep workflow primitive implementations under `runtime/primitives/`; add globals through the shared `WorkflowPrimitive` protocol in `runtime/context.ts` and `runtime/globals.ts` instead of ad hoc wiring.
- Inject `WorkflowAgent`; never hardcode pi/model providers.
- Put TUI and visible text rendering in `display/`, one display concern per file.
- Put raw prompt text in `prompts/*.txt`; keep interpolation code outside `prompts/`.
- Keep generated workflow authoring docs in `authoring-guide.ts`; render them into prompts through placeholders.
- Steer generated workflows toward the default outside-project draft root provided in the current session prompt; when using that default, call `propose_workflow` with the workflow name and omit `draftDir`. If an explicit alternate `draftDir` is needed, it must point at the directory, not the `workflow.js` file.
- Require generated workflow source to document the default workflow function with JSDoc covering input fields/defaults, phases, child agents, file reads, and result shape.
- Generated workflow child-agent prompts must be self-contained expert task packets with source-of-truth paths, prior results, invariants, concrete operating instructions, evidence requirements, pass/fail gates, and exact artifacts to read or write.
- Shared prompt context is allowed, but format it as a compact contract (`Inputs`, `Purpose`, `Definitions`, `Rules`, `Task`, `Output`) instead of an unstructured global preamble dump; omit irrelevant globals for that stage.
- Put reusable generated-workflow child-agent prompt templates in workflow-local `prompts/*.txt` files, use `{{name}}` placeholders, and render them with `renderPrompt`; reserve inline prompts for tiny one-off glue.
- Keep helpers purposeful; inline short functions that only obscure flow.
- Preserve workflow sandbox constraints around ambient authority: workflows cannot import modules or use Node globals, `renderPrompt` must resolve only through the workflow's own `prompts/` directory, and `readText`/`readJson`/`writeText`/`writeJson` may use absolute paths, project-cwd-relative paths, or `@workflow/...` paths.
- Keep workflow child-agent SDK sessions isolated from ambient pi extensions by default; load only `workflow.childAgentExtensions` from merged global/project settings so parent-session extension tools/hooks cannot mutate global extension state.
- Keep `agent(prompt, { cwd })` as a launch option for alternate child-agent working directories; resolve relative values from the workflow project cwd.
- Encourage workflow authors to add `log(message)` for visible milestones and `trace(label, value?)` for structured handoff/debug data.
- Treat structured JSON as a control surface: keep schemas bounded and compact, return manifest/status/IDs/paths, and put large reasoning/evidence/artifacts in files or JSONL.
- Keep workflow results, including strings, in output files and session logs; do not inject them into the parent session as hidden follow-up prompts.
- Never estimate token counts; only report provider/session usage or zero/unknown when actual usage is unavailable.
- Update tests and docs when exported behavior or workflow primitives change.

## Key types

- `runtime/types.ts`: `WorkflowMetadata`, `WorkflowAgentOptions`, `WorkflowAgent`, `WorkflowSnapshot`, `RunWorkflowOptions`, `WorkflowRunResult`.
- `runtime/`: runtime internals. `run.ts` owns workflow execution wiring, `context.ts` defines the shared primitive protocol, `globals.ts` binds primitives, and `primitives/` owns agent/phase/log/trace/files/parallel/pipeline/coerce/mapreduce/verifier behavior.
- `workflow/files.ts`: shared read/write helpers and atomic file-writing utilities used by workflow primitives and output persistence.
- `workflow/`: workflow pathing, metadata, sandbox, output, draft, and settings helpers.
- `request.ts`: `GeneratedWorkflowDraft` validation and draft saving.
- `discovery.ts`: `WorkflowReference`.
- `tools.ts`: `WorkflowToolsOptions`.
- `pi-agent.ts`: `PiWorkflowAgentOptions`.
- `authoring-guide.ts`: on-demand workflow design guidance returned by the `workflow_design_guidance` tool.
- `display/`: passive progress and boundary message rendering.
- `prompts/`: raw prompt templates loaded by `prompt-templates.ts`.

See `../agent_docs/INDEX.md` before changing patterns.
