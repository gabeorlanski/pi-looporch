# Agent Documentation Index

<!-- Rules here are inspired by PR-review-pattern indexes: short, topic-grouped, and durable. -->

## Commands

```bash
npm run lint
npm run lint:fix
npm run format
npm run format:check
npm run typecheck
npm test
npm run loadcheck
npm run precommit
npm run check
```

## Repository goal

Build a small dependency-light pi extension for code-first project workflows. The extension exposes pi commands/tools that discover, run, review, and generate `.pi/workflows/<workflow-name>/workflow.js` workflows using simple agent orchestration primitives such as `agent`, `parallel`, `pipeline`, `coerce`, `mapreduce`, `verifier`, and `trace`. Workflow authoring is optimized for power-user/agent-authored executable runbooks, with strong observability and easy tweaking valued over package-like shareability.

## Rule admission

- Add a rule when user guidance or code pushback is a generalizable coding pattern.
- Do not add one-off preferences, temporary task constraints, or stale implementation notes.
- Keep rules topic-grouped, short, actionable, and easy to scan.
- Keep `README.md`, `docs/`, `agent_docs/`, and relevant `AGENTS.md` files synchronized with behavior and coding-standard changes.

## Coding Guidelines

### Code Organization

- Put pi command, TUI, and extension registration wiring in `extensions/`; put workflow orchestration logic in `src/`.
- Put TUI and visible text rendering under `src/display/`, with one display concern per file.
- Keep raw agent prompt text in `src/prompts/*.txt`; keep typed interpolation and domain shaping outside the prompt directory.
- Keep rendered authoring guidance outside raw prompt files; raw prompts should receive generated guides through placeholders.
- Parse and normalize at command/UI/tool boundaries; keep `src/` strict and already-normalized.
- Prefer simple functions and direct data types over managers, class hierarchies, or premature abstractions.
- Give every function a clear job; inline short helpers that only hide one expression or rename a local concept.
- Keep dependencies minimal and justified for a pi extension.
- Use strict ESLint for code quality and Prettier for formatting; do not mix formatting preferences into lint rules.

### TypeScript Types

- Treat exported interfaces/types as the source of truth for workflow data shapes.
- Avoid false optionality in core logic; make required runtime data required in types.
- Use narrow literal unions for fixed string sets such as statuses, actions, and reasoning levels.

### Runtime and Boundaries

- Inject `WorkflowAgent` and reviewers; never hardcode model or pi providers into core logic.
- Keep generated workflows review-gated before save or run.
- Propose generated workflows as complete project-local draft directories such as `.pi/workflow-drafts/<name>/`; `propose_workflow` `draftDir` values should point at the directory, not the `workflow.js` file.
- Require workflow metadata to include `phases: [{ title, detail? }]`; this planned runbook outline is required preview data, while runtime `phase()` calls are actual progress.
- Require agent-generated workflow source to document the default workflow function with JSDoc covering purpose, input fields/defaults, phases, child agent usage, file reads, and result shape.
- Let workflow `readText`/`readJson` read files anywhere the pi process can read: absolute paths as absolute, bare relative paths from project `cwd`, and `@workflow/...` paths from the workflow directory.
- Keep prompt templates behind `renderPrompt` and the workflow's own `prompts/` directory.
- When a requested behavior change is a cutover, remove the old path instead of adding compatibility fallback.
- Lean into power-user workflow style: top-level constants, inline schemas, prompt-builder helpers, and local runbook assumptions are acceptable when they make workflows easier for agents to inspect and tweak.
- Generated workflow child-agent prompts must be self-contained expert task packets: include mission, source-of-truth paths, relevant prior results, invariants, concrete commands/search strategy, evidence requirements, pass/fail gates, and exact artifacts to read or write.
- Shared prompt context is allowed, but format it as a compact contract (`Inputs`, `Purpose`, `Definitions`, `Rules`, `Task`, `Output`) instead of an unstructured global preamble dump; omit irrelevant globals for that stage.
- Put reusable generated-workflow child-agent prompt templates in workflow-local `prompts/*.txt` files, use `{{name}}` placeholders, and render them with `renderPrompt`; reserve inline prompts for tiny one-off glue.
- Use adversarial verifier/repair stages for important generated artifacts; reviewer prompts should cite evidence and separate major correctness failures from recommendations.
- Prefer `agent(prompt, { schema, maxAttempts? })` for child agents that do real work and must return typed JSON; reserve `coerce` for no-tools extraction/normalization.
- Treat structured JSON as a control surface, not the payload: return status, decisions, stable IDs, counts, line/evidence references, short summaries, and artifact paths; put reasoning, transcripts, diffs, generated reports, and large evidence in files or JSONL artifacts.
- Keep structured-output schemas token-efficient with short keys, bounded strings/lists, enums/booleans, `additionalProperties: false`, stable lookup IDs, and staged expansion for only selected items that need detail.
- Use `agent(prompt, { cwd })` when a child agent should operate from a scratch or alternate directory; relative `cwd` values resolve from the workflow project cwd.
- Use `log(message)` for user-facing workflow milestones before slow agent launches, after important decisions/results, and at handoffs; use `trace(label, value?)` for durable structured workflow-local debugging state that should appear in snapshots/run events.
- Keep workflow dataflow explicit: `phase()` is a progress marker, not shared memory, and later agents should receive earlier results only when the workflow renders those results into their prompts.
- Keep workflow discovery resilient: startup, autocomplete, and listing paths must skip one invalid workflow definition instead of crashing pi.
- Throw actionable `Error` messages at boundaries when user input, metadata, or workflow config is invalid.
- Never estimate token counts. Use provider usage from pi events/session JSONL, or show zero/unknown when actual usage is unavailable.
- Named workflow commands must not require users to hand-write JSON; direct JSON/key-value input should validate required fields, while freeform named-workflow input should become a visible, steerable session conversation that shows the exact prompt using `metadata.inputInstructions` plus the workflow function JSDoc/signature before calling `run_workflow`.
- Workflow parallelism is bounded by project `.pi/settings.json` `workflow.maxParallelAgents`; enforce it globally for child-agent launches, and make `parallel` queue excess fan-out workers instead of launching unbounded work.
- Workflow completion messages should keep parent-agent handoff compact: include the workflow session-log directory path, and save structured phase/fan-out/agent/session metadata inside that directory.
- When a workflow's default `workflow()` function returns a string, treat it as the parent-agent handoff: tool runs return it to the calling orchestrator, and direct slash-command runs inject it as a hidden follow-up to the current session agent. Use object returns for machine-readable data that should stay in logs/details.
- Auto-added child-agent runtime-log entries should show bare tool names such as `bash` or `read`; keep detailed tool progress in counters/transcripts unless the workflow explicitly logs it.
- Advertised TUI shortcuts should be macOS-terminal friendly: prefer reliable control sequences over F-keys or Option/Alt-only bindings, and keep legacy fallbacks only when they do not conflict.

### Testing

- Use deterministic fake agents only; never call real models or live pi sessions from tests.
- Add or update tests for behavior changes, bug fixes, and user pushback that changes expected behavior.
- Keep Husky/lint-staged pre-commit actions aligned with `lint`, `format`, and TypeScript expectations.
- Prefer focused behavior tests over broad snapshots.

### Documentation

- Update user-facing docs when commands, tools, workflow primitives, review behavior, sandbox rules, or storage layout change.
- Keep `agent_docs/INDEX.md` as topic-grouped coding guidance, not a chronological work log.
- Mirror durable guidance changes into relevant `AGENTS.md` files.

## Key data shapes

- Runtime types: `src/runtime-types.ts` defines `WorkflowMetadata`, `WorkflowAgentOptions`, `WorkflowAgent`, `WorkflowSnapshot`, `RunWorkflowOptions`, and `WorkflowRunResult`.
- Runtime execution: `src/runtime.ts` wires workflow execution and re-exports public runtime APIs; `src/workflow-paths.ts`, `src/workflow-sandbox.ts`, and `src/workflow-metadata.ts` own path resolution, sandbox transforms, and static metadata parsing.
- Workflow review: `src/request.ts` defines `GeneratedWorkflowDraft`, `WorkflowReviewer`, and review-gated draft saving.
- Discovery: `src/discovery.ts` defines `WorkflowReference` and workflow root handling.
- Settings: `src/workflow-settings.ts` defines workflow project settings parsing and persistence.
- Tools: `src/tools.ts` defines `WorkflowToolsOptions` and tool creation.
- Pi bridge: `src/pi-agent.ts` defines `PiWorkflowAgentOptions`.
- Prompt templates: `src/prompts/*.txt` contains raw agent prompt copy; `src/prompt-templates.ts` binds typed data into those templates.
- Authoring guide: `src/authoring-guide.ts` owns on-demand workflow design guidance returned by `workflow_design_guidance`; routing prompts should stay compact and point agents to the tool instead of embedding verbose examples.
- Display: `src/display/` contains progress, approval, and message renderers.

## Repository map

- `extensions/workflow.ts`: pi extension entry, commands, aliases, TUI workflow approval.
- `src/runtime.ts`: sandboxed workflow execution wiring and progress snapshots.
- `src/runtime-types.ts`: runtime public type contracts.
- `src/workflow-paths.ts`: workflow path/name/cwd helpers.
- `src/workflow-sandbox.ts`: source transform and import/require restrictions.
- `src/workflow-metadata.ts`: static metadata extraction.
- `src/discovery.ts`: local and configured workflow root discovery.
- `src/workflow-settings.ts`: project `.pi/settings.json` workflow settings.
- `src/request.ts`: natural-language workflow selection/generation/review/save flow.
- `src/tools.ts`: `run_workflow`, `workflow_design_guidance`, `debug_workflow`, and `propose_workflow` tool definitions.
- `src/display/`: TUI progress, approval, and visible message rendering.
- `src/prompts/`: raw prompt templates for agent-facing instructions.
- `tests/`: deterministic coverage for each core module.
