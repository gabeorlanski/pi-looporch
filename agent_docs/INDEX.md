# Agent Documentation Index

<!-- Rules here are inspired by PR-review-pattern indexes: short, topic-grouped, and durable. -->

## Commands

```bash
npm run lint
npm run lint:fix
npm run format
npm run format:check
npm run docs:check
npm run typecheck
npm test
npm run loadcheck
npm run precommit
npm run check
```

## Repository goal

Build a small dependency-light pi extension for code-first project workflows. The extension exposes pi commands/tools that discover, run, review, and generate `.pi/workflows/<workflow-name>/workflow.js` workflows using simple agent orchestration primitives such as `agent`, `parallel`, `pipeline`, `mapreduce`, `verifier`, and `trace`. Workflow authoring is optimized for power-user/agent-authored executable runbooks, with strong observability and easy tweaking valued over package-like shareability.

## Rule admission

- Add a rule when user guidance or code pushback is a generalizable coding pattern.
- Do not add one-off preferences, temporary task constraints, or stale implementation notes.
- Keep rules topic-grouped, short, actionable, and easy to scan.
- Keep `README.md`, `docs/`, `agent_docs/`, and relevant `AGENTS.md` files synchronized with behavior and coding-standard changes.

## Coding Guidelines

### Topic Guides

- [Terminal UI Style](tui-style.md): predictable terminal rendering across widths, non-TTY sinks, color-off environments, and concurrent agent activity.
- [Pi Agent Harness & Orchestration](pi-agent-harness.md): agent SDK boundaries, child-agent isolation, session lifecycle, and observability.
- [TypeScript and JavaScript Style](typescript-javascript-style.md): strict, ESM-first TypeScript with boundary coercion, errors, async hygiene, and deterministic tests.
- [Documentation Style](documentation-style.md): concise technical docs with exact names, runnable examples, and doc/behavior synchronization.

### Code Organization

- Put pi command, TUI, and extension registration wiring in `extensions/`; put workflow orchestration logic in `src/`.
- Put runtime implementation under `src/runtime/`, including workflow execution in `src/runtime/run.ts`; import runtime types from `src/runtime/types.ts` and workflow helpers from `src/workflow/`.
- Keep workflow runtime primitives in `src/runtime/primitives/` and register their globals through the shared `WorkflowPrimitive` protocol instead of adding ad hoc branches to `src/runtime/globals.ts`.
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

- Inject `WorkflowAgent`; never hardcode model or pi providers into core logic.
- Propose generated workflows as complete project-local draft directories such as `.pi/workflow-drafts/<name>/`; `propose_workflow` `draftDir` values should point at the directory, not the `workflow.js` file.
- `propose_workflow` saves directly after validating the draft directory and child-agent capabilities; it must statically resolve inline or top-level `const` capability lists, validate inherited settings defaults against Pi's real extension/tool metadata, aggregate source-located failures, and leave published workflows untouched on error.
- Require workflow metadata to include `phases: [{ title, detail? }]`; this planned runbook outline is required planning data, while runtime `phase()` calls are actual progress.
- Require agent-generated workflow source to document the default workflow function with JSDoc covering purpose, input fields/defaults, phases, child agent usage, file reads, and result shape.
- Let workflow `readText`/`readJson` read and `writeText`/`writeJson` write files anywhere the pi process can access: absolute paths as absolute, bare relative paths from project `cwd`, and `@workflow/...` paths from the workflow directory. Keep shared pathing and atomic write behavior in common workflow helpers, not per-primitive ad hoc code.
- Keep prompt templates in the workflow's own `prompts/` directory and launch reusable ones through `agent({ template, values }, options)`; reserve `renderPrompt` for exceptional composition.
- When a requested behavior change is a cutover, remove the old path instead of adding compatibility fallback.
- Lean into power-user workflow style: top-level constants, inline schemas, prompt-builder helpers, and local runbook assumptions are acceptable when they make workflows easier for agents to inspect and tweak.
- Generated workflow child-agent prompts must be self-contained expert task packets: include mission, source-of-truth paths, relevant prior results, invariants, concrete commands/search strategy, evidence requirements, pass/fail gates, and exact artifacts to read or write.
- Use Markdown or plain text by default in child prompts. Add a few stable domain-specific XML tags only when complex mixed instructions, context, examples, documents, or dynamic inputs need unambiguous boundaries; do not tag every heading or sentence. Tags are delimiters, not a security boundary; use `schema` and `StructuredOutput` for machine-readable results. Pi-workflow owns `<workflow_instructions>`, `<workflow_task>`, `<workflow_context>`, and, for schema-enabled agents, `<structured_output_contract>` and `<structured_output_schema>`; do not reuse them in child prompt templates. Treat workflow-supplied data as non-user content, keep it intentionally small, and omit inputs/globals that the stage does not directly consume.
- Put reusable generated-workflow child-agent prompt templates in workflow-local `prompts/*.txt` files and launch them with `agent({ template, values }, options)`. Keep static rules/examples verbatim in the cacheable prefix, put only dynamic data in domain-specific sections, pass paths/IDs/counts or compact manifests instead of repeated bulk context, require every `{{name}}` placeholder to receive a value, and reserve inline prompts for tiny one-off glue.
- If a workflow needs more than five distinct non-verifier prompts, split them into separate prompt files rather than packing variants into `workflow.js` or one oversized template.
- Use adversarial verifier/repair stages for important generated artifacts only when the risk justifies the extra agents; verifier prompts should cite evidence and separate major correctness failures from recommendations.
- Prefer `agent({ template, values }, { schema })` for child agents that need structured fields. The schema is prepended to the prompt and becomes the terminal `StructuredOutput` tool contract; Pi validates keyword arguments, the tool ends the session, and a missing call is an error.
- Treat structured JSON as a control surface, not the payload: return status, decisions, stable IDs, counts, line/evidence references, short summaries, and artifact paths; put reasoning, transcripts, diffs, generated reports, and large evidence in files or JSONL artifacts.
- Keep structured-output schemas token-efficient with short keys, bounded strings/lists, enums/booleans, `additionalProperties: false`, stable lookup IDs, and staged expansion for only selected items that need detail.
- Use `agent({ template, values }, { cwd })` when a child agent should operate from a scratch or alternate directory; relative `cwd` values resolve from the workflow project cwd.
- Use `log(message)` for user-facing workflow milestones before slow agent launches, after important decisions/results, and at handoffs; use `trace(label, value?)` for durable structured workflow-local debugging state that should appear in snapshots/session summaries.
- Keep workflow dataflow explicit: `phase()` is a progress marker, not shared memory, and later agents should receive earlier results only when the workflow renders those results into their prompts.
- Keep workflow discovery resilient: startup, autocomplete, and listing paths must skip one invalid workflow definition instead of crashing pi.
- Throw actionable `Error` messages at boundaries when user input, metadata, or workflow config is invalid.
- Never estimate token counts. Use provider usage from pi events/session JSONL, or show zero/unknown when actual usage is unavailable.
- Named workflow commands must not require users to hand-write JSON; direct JSON/key-value input should validate required fields, while freeform named-workflow input should become a visible, steerable session conversation that shows the exact prompt using `metadata.inputInstructions` plus the workflow function JSDoc/signature before calling `run_workflow`.
- `/workflow` steering prompts must require agents to resolve clear ambiguities from project context before asking. For new workflow authoring, infer purpose, inputs/defaults, phases, child-agent roles, file reads, and result shape from the request, docs, code, tests, and existing workflows when reasonably clear; ask only for unknowable or high-impact choices.
- Workflow parallelism is bounded by project `.pi/settings.json` `workflow.maxParallelAgents`; enforce it globally for child-agent launches, and make `parallel` queue excess fan-out workers instead of launching unbounded work.
- `agent`, `mapreduce`, and `verifier` accept `extensions?: string[]` and `tools?: string[]`; omission inherits merged `workflow.childAgentExtensions`/`workflow.childAgentTools`, absent settings mean all, `[]` means none, and per-call lists override their corresponding defaults. Schema-enabled agents always receive `StructuredOutput`.
- Treat an explicit tool list as exact: an extension-owned tool implies and loads its owner but does not expose sibling tools; an explicit extension list with unrestricted tools exposes the built-ins plus all tools from those extensions. Capability state must stay child-session-local and never mutate parent/global extension state.
- Workflows started by named commands and by the current-session agent through `run_workflow` should share the same TUI running-workflow widget, `/view-workflow` inspector entrypoint, reload reattachment, and cleanup behavior, scoped to the parent Pi session id rather than cwd alone.
- `workflow_status`, `/workflow-status`, and the passive monitor widget are project-scoped by default and may show workflows owned by other Pi sessions; use `scope: "current-session"` only when the caller explicitly wants the current session.
- Configured workflow roots live in `.pi/settings.json` or global settings as `workflow.workflowDirs`; discovery resolves those paths from the project root.
- Workflow completion handoffs should be sent as visible automated user messages, not custom extension messages. Use a typed `<workflow_handoff>` envelope with a bounded result/report preview plus output/session-log paths so the agent can review and summarize the result without confusing automation with user text.
- `/workflow-review` reviews actual workflow session logs for token-cost reduction; keep it focused on recorded token spend, repeated tool activity, common commands across agents, and actionable ways to reduce future workflow cost.
- Do not show the runtime log in the collapsed workflow TUI widget; show compact workflow status, agent counts, elapsed time, and token totals. Keep phase/agent detail in the explicit inspector: details are always expanded there, exact prompts are collapsed until requested, and the three most recent bounded tool-call summaries plus child-agent output are loaded from artifacts on demand.
- Child-agent `events.jsonl` logs are runtime metadata, not transcripts: do not persist streamed message deltas or duplicate conversation payloads there; keep final messages and tool results in the canonical pi session JSONL.
- Avoid workflow keybindings unless the user explicitly asks for an interactive control surface; when enabled, keep them scoped to the workflow widget/inspector handoff.

### Testing

- Use deterministic fake agents only; never call real models or live pi sessions from tests.
- Add or update tests for behavior changes, bug fixes, and user pushback that changes expected behavior.
- Keep Husky/lint-staged pre-commit actions aligned with `lint`, `format`, docs contracts, and TypeScript expectations.
- Prefer focused behavior tests over broad snapshots.

### Documentation

- Update user-facing docs when commands, tools, workflow primitives, review behavior, sandbox rules, or storage layout change; staged behavior-surface changes must include a staged README/docs/agent_docs/AGENTS update.
- Begin every maintained TypeScript module with a concise purpose JSDoc and document every exported callable declaration with a leading JSDoc contract; ESLint enforces both requirements.
- Keep `agent_docs/INDEX.md` as topic-grouped coding guidance, not a chronological work log.
- Mirror durable guidance changes into relevant `AGENTS.md` files.

## Key data shapes

- Runtime types: `src/runtime/types.ts` defines `WorkflowMetadata`, `WorkflowAgentOptions`, `WorkflowAgent`, `WorkflowSnapshot`, `RunWorkflowOptions`, and `WorkflowRunResult`.
- Runtime execution: `src/runtime/run.ts` wires sandboxed execution; `src/workflow/start.ts` owns shared run preparation/start policy for commands and tools; `src/workflow/background-runs.ts` owns background execution, active-run registration, outputs, and session-summary closeout.
- Workflow source analysis: `src/workflow/source-analysis.ts`, `src/workflow/sandbox.ts`, `src/workflow/metadata.ts`, `src/workflow/input-contract.ts`, and `src/workflow/agent-capability-source.ts` own AST restrictions, sandbox transforms, static metadata/input parsing, and child-agent capability extraction.
- Workflow saving: `src/workflow/draft-save.ts` defines `GeneratedWorkflowDraft` validation and draft saving.
- Discovery: `src/discovery.ts` defines `WorkflowReference` and workflow root handling; workflow root settings come from `src/workflow/settings.ts`.
- Settings: `src/workflow/settings.ts` defines workflow global/project settings parsing and persistence, including configured workflow roots and child-agent extension/tool defaults.
- Tools: `src/tools.ts` defines `WorkflowToolsOptions` and tool creation.
- Pi bridge: `src/pi-agent.ts` defines `PiWorkflowAgentOptions`; `src/pi-agent-capabilities.ts` builds extension/tool catalogs and `src/pi-agent-capability-resolution.ts` owns typed access resolution; session event filtering, token usage, and logged child-session persistence live in `src/session-events.ts`, `src/session-usage.ts`, and `src/agent-session-logs.ts`.
- Prompt templates: `src/prompts/*.txt` contains raw agent prompt copy; `src/prompt-templates.ts` binds typed data into those templates.
- Authoring guide: `src/authoring-guide.ts` owns on-demand workflow design guidance returned by `workflow_design_guidance`; routing prompts should stay compact and point agents to the tool instead of embedding verbose examples.
- Display: `src/display/` contains progress/message renderers plus the running-workflow widget, inspector, and visible-run UI lifecycle.

## Question Dispatch

- Run an existing workflow from a slash command: start in `extensions/workflow.ts`, then `src/workflow/start.ts`, `src/workflow/background-runs.ts`, and `src/runtime/run.ts`.
- Run an existing workflow from a tool: start in `src/tools.ts`, then follow the same `src/workflow/start.ts` -> `src/workflow/background-runs.ts` -> `src/runtime/run.ts` path.
- Parse named-command input: `src/input.ts` parses raw JSON/key-value/freeform command text; `src/workflow/input-contract.ts` reads workflow function/JSDoc contracts and validates normalized direct input.
- Discover workflows and configured roots: `src/discovery.ts` plus `src/workflow/settings.ts`.
- Save generated workflow drafts: `src/workflow/draft-save.ts` saves validated draft directories, `src/workflow/drafts.ts` reads them from the default draft root, and `src/workflow/agent-capability-validation.ts` rejects invalid child-agent capability selections before saving.
- Understand runtime primitives: `src/runtime/globals.ts` registers primitives from `src/runtime/primitives/`; shared primitive context lives in `src/runtime/context.ts`.
- Inspect active workflow status: data comes from `src/workflow/status.ts`, active records from `src/workflow/active-runs.ts`, snapshots from `src/workflow/active-run-snapshots.ts`, rendering from `src/display/workflow-status.ts`, slash command parsing from `extensions/commands/status.ts`, and tool wiring from `src/tools.ts`.
- Inspect workflow UI: running widget lifecycle lives in `src/display/running-workflow-ui.ts`, command/tool visible-run startup in `src/display/visible-workflow-run.ts`, compact widget rendering in `src/display/workflow-widget.ts`, and detail inspector rendering in `src/display/workflow-inspector.ts`.
- Inspect outputs and artifacts: `src/workflow/outputs.ts` writes final output, snapshots, manifests, child-agent prompts, child-agent output, and tool activity artifacts.
- Inspect session logs and cost review: `src/session-logs.ts` writes workflow summaries, `src/agent-session-logs.ts` creates child-agent session logs, `src/session-events.ts` filters event metadata, `src/session-transcript.ts` reads session JSONL, `src/session-usage.ts` parses token usage, and `src/log-review.ts` builds `/workflow-review`.
- Inspect pi child-agent integration: `src/pi-agent.ts` adapts pi sessions to `WorkflowAgent`, applies child-agent extension/tool selections, reports progress, and re-exports log/session helpers; catalogs live in `src/pi-agent-capabilities.ts` and typed ownership resolution lives in `src/pi-agent-capability-resolution.ts`.

## Repository map

- `extensions/workflow.ts`: pi extension entry, tool registration, workflow command steering, named workflow aliases, and session hooks.
- `extensions/commands/status.ts`: `/workflow-status` argument parsing and host message wiring.
- `extensions/commands/settings.ts`: `/workflow-settings` argument parsing and settings writes.
- `extensions/commands/review.ts`: `/workflow-review` host message wiring.
- `src/display/visible-workflow-run.ts`: shared visible workflow launch, UI tracking, cleanup, and post-start completion/failure handoff for command and tool launches.
- `src/runtime/run.ts`: sandboxed workflow execution wiring and progress snapshots.
- `src/runtime/types.ts`: runtime public type contracts.
- `src/workflow/start.ts`: shared workflow lookup, input validation, settings, run id, initial snapshot, and background-start policy.
- `src/workflow/background-runs.ts`: background run lifecycle, active-run record registration, final output/session summary persistence, and cleanup.
- `src/workflow/source-analysis.ts`, `src/workflow/agent-capability-source.ts`: shared workflow AST validation plus static child-agent capability analysis.
- `src/workflow/input-contract.ts`: default workflow function/JSDoc input contract extraction and normalized input validation.
- `src/workflow/paths.ts`: workflow path/name/cwd helpers.
- `src/workflow/sandbox.ts`: source transform and import/require restrictions.
- `src/workflow/metadata.ts`: static metadata extraction.
- `src/workflow/outputs.ts`: workflow output directories, final results, snapshot/manifest persistence, and child-agent artifacts.
- `src/workflow/status.ts`: active-run status projection for tools and commands.
- `src/workflow/active-runs.ts`, `src/workflow/active-run-snapshots.ts`: active-run records and snapshot rehydration.
- `src/workflow/drafts.ts`: generated draft directory reading and default draft path helpers.
- `src/discovery.ts`: local and configured workflow root discovery.
- `src/workflow/settings.ts`: global `~/.pi/agent/settings.json` and project `.pi/settings.json` workflow settings.
- `src/workflow/draft-save.ts`: generated workflow draft validation and saving.
- `src/workflow/agent-capability-validation.ts`: proposal-time capability validation against real Pi extension/tool metadata.
- `src/input.ts`: direct slash-command input parsing only.
- `src/tools.ts`: `run_workflow`, `workflow_design_guidance`, and `propose_workflow` tool definitions.
- `src/session-events.ts`, `src/session-usage.ts`, `src/agent-session-logs.ts`: child-agent session event filtering, token usage parsing, and persisted child-session setup.
- `src/session-logs.ts`, `src/session-transcript.ts`, `src/log-review.ts`: workflow session summary paths, session JSONL reading, and cost-review reports.
- `src/display/`: progress rendering, status rendering, running widget lifecycle, visible-run startup, and inspector UI.
- `src/prompts/`: raw prompt templates for agent-facing instructions.
- `tests/`: deterministic coverage for each core module.
