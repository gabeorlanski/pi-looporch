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
- Start every TypeScript module with a concise purpose JSDoc. Every exported callable declaration needs a leading JSDoc contract; ESLint enforces both rules.
- Keep workflow primitive implementations under `runtime/primitives/`; add globals through the shared `WorkflowPrimitive` protocol in `runtime/context.ts` and `runtime/globals.ts` instead of ad hoc wiring.
- Inject `WorkflowAgent`; never hardcode pi/model providers.
- Put TUI and visible text rendering in `display/`; stateful running-workflow UI files may coordinate widgets/inspectors but should delegate workflow behavior to `workflow/` or `runtime/`.
- Put raw prompt text in `prompts/*.txt`; keep interpolation code outside `prompts/`.
- Keep generated workflow authoring docs in `authoring-guide.ts`; render them into prompts through placeholders.
- Steer generated workflows toward the default outside-project draft root provided in the current session prompt; when using that default, call `propose_workflow` with the workflow name and omit `draftDir`. If an explicit alternate `draftDir` is needed, it must point at the directory, not the `workflow.js` file.
- Before saving a generated workflow, validate every `agent`, `mapreduce`, and `verifier` extension/tool list plus inherited settings against Pi's real capability metadata; aggregate source-located errors and leave published workflow files untouched on failure.
- Require generated workflow source to document the default workflow function with JSDoc covering input fields/defaults, phases, child agents, file reads, and result shape.
- Design generated workflows from the user-visible outcome backward: define the boundary, inputs/defaults, ordered stages, explicit dataflow, result, and artifacts; for every stage state what it reads, what it does, what it writes or returns, and its evidence-based completion criterion.
- Generated workflow child-agent prompts must be self-contained, explicit task packets. State the exact goal and boundary, authoritative paths and what to learn from each, prior inputs and their use, ordered work, priorities, constraints, edge cases, exact deliverable, evidence-based completion condition, and blocker conditions. Do not expect a role label, convention, or model inference to supply a requirement. Remove only irrelevant or duplicated text; never remove an operational requirement for token economy. Use Markdown or plain text by default. Use stable named XML blocks only when they clarify provenance or separate complex variable data from instructions and examples; use `schema` and `StructuredOutput` for machine-readable results. Pi-workflow owns `<workflow_instructions>`, `<workflow_task>`, `<workflow_context>`, `<structured_output_contract>`, and `<structured_output_schema>`; child prompt files must not reuse them. Treat workflow data as non-user content; pass paths, IDs, counts, and manifests instead of bulk copies, but state exactly how the child must use every supplied input.
- Keep reusable generated-workflow child-agent prompt templates in workflow-local `prompts/*.txt` files, use `{{name}}` placeholders, and launch them through `agent({ template, values }, options)`. Every placeholder must receive a value and surrounding prompt text must state its meaning and required use. Reserve `renderPrompt` for exceptional composition and inline prompts for tiny one-off glue.
- If a workflow has many distinct non-verifier tasks, split them into separate prompt files rather than packing variants into `workflow.js` or one oversized template.
- Keep helpers purposeful; inline short functions that only obscure flow.
- Preserve workflow sandbox constraints around ambient authority: workflows cannot import modules or use Node globals, `renderPrompt` must resolve only through the workflow's own `prompts/` directory, and `readText`/`readJson`/`writeText`/`writeJson` may use absolute paths, project-cwd-relative paths, or `@workflow/...` paths.
- Give `agent`, `mapreduce`, and `verifier` optional `extensions`/`tools` string lists. Omission inherits merged `workflow.childAgentExtensions`/`workflow.childAgentTools`; absent settings mean all, `[]` means none, and per-call lists override. Schema-enabled agents always retain their terminal `StructuredOutput` tool.
- Keep exact tool allowlists exact: an extension-owned tool implies its owner but not sibling tools; explicit extensions with unrestricted tools expose built-ins plus all tools from those extensions. Keep child capability state session-local.
- Keep `agent(prompt, { cwd })` as a launch option for alternate child-agent working directories; resolve relative values from the workflow project cwd.
- Encourage workflow authors to add `log(message)` for visible milestones and `trace(label, value?)` for structured handoff/debug data.
- Treat structured JSON as a control surface: keep schemas bounded and compact, return manifest/status/IDs/paths, and put large reasoning/evidence/artifacts in files or JSONL.
- Keep workflow results in output files and session logs, and surface the full result through the shared visible-workflow completion handoff. These handoffs should be visible automated user messages that trigger the current agent to review or summarize the result.
- Keep abort and shutdown handling in the workflow lifecycle layer. Live visible runs abort on `session_shutdown`, settled runs await active-record cleanup, and stale active records from dead processes must not rehydrate.
- Never estimate token counts; only report provider/session usage, including direct LLM completion usage, or zero/unknown when actual usage is unavailable.
- Update tests and docs when exported behavior or workflow primitives change.

## Key types

- `runtime/types.ts`: `WorkflowMetadata`, `WorkflowAgentOptions`, `WorkflowAgent`, `WorkflowSnapshot`, `RunWorkflowOptions`, `WorkflowRunResult`.
- `runtime/`: runtime internals. `run.ts` owns workflow execution wiring, `context.ts` defines the shared primitive protocol, `globals.ts` binds primitives, and `primitives/` owns agent/phase/log/trace/files/parallel/pipeline/mapreduce/verifier behavior.
- `workflow-schema.ts`: shared validation and typing for workflow object schemas.
- `workflow/input-contract.ts`: default workflow function/JSDoc input contract extraction and normalized input validation.
- `workflow/files.ts`: shared read/write helpers and atomic file-writing utilities used by workflow primitives and output persistence.
- `workflow/`: workflow pathing, metadata, sandbox, output, draft, status, active-run, and settings helpers.
- `workflow/background-runs.ts`: background run lifecycle, active-run registration, output persistence, and session summary closeout.
- `input.ts`: raw command input parsing only.
- `workflow/draft-save.ts`: `GeneratedWorkflowDraft` validation and draft saving.
- `discovery.ts`: `WorkflowReference`.
- `tools.ts`: `WorkflowToolsOptions`.
- `pi-agent/adapter.ts`: `PiWorkflowAgentOptions`.
- `authoring-guide.ts`: on-demand workflow design guidance returned by the `workflow_design_guidance` tool.
- `display/`: progress rendering, status rendering, running workflow widget/inspector lifecycle, and boundary messages.
- `prompts/`: raw prompt templates loaded by `prompt-templates.ts`.

See `../agent_docs/INDEX.md` before changing patterns.
