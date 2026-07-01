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
npm run docs:check    # exported API docstrings and docs-sync contracts
npm run typecheck     # TypeScript without emit
npm test              # deterministic node:test suite
npm run loadcheck     # verify pi can load the extension
npm run precommit     # run lint-staged plus staged documentation pre-commit actions
npm run pack:dry      # inspect published package contents
```

## Repository goal

`pi-workflow` is a small pi extension that lets projects run, review, and generate code-first workflows. Workflows live under `.pi/workflows/<name>/workflow.js` and use simple orchestration primitives such as `agent`, `parallel`, `pipeline`, `coerce`, `mapreduce`, `verifier`, `phase`, `log`, `trace`, `cwd`, `budget`, `readText`, `readJson`, `writeText`, `writeJson`, and `renderPrompt`.

## Documentation standard

Keep these in sync with every behavior or convention change. Pre-commit enforces staged documentation updates for behavior-surface changes and JSDoc on exported public API declarations:

- `README.md`: user-facing install, usage, and examples.
- `docs/`: design specs and durable product/architecture decisions.
- `agent_docs/`: concise coding rules learned from user guidance.
- Every relevant `AGENTS.md`: instructions agents need before editing that area.

When the user gives coding guidance or pushes back on code, add a rule to `agent_docs/INDEX.md` only if it is a generalizable coding pattern. Do not record one-off preferences, task-specific notes, or stale workarounds.

Keep this root `AGENTS.md` limited to the highest-level, durable rules agents need across the whole repository. Do not add feature-specific behavior details, implementation notes, or test recipes here; put those in `docs/`, `agent_docs/`, or a narrower `AGENTS.md`.

## Workflow authoring and running model

Keep the mental model simple:

```text
User asks for workflow help
  -> current session agent decides: use existing workflow OR author a new one
  -> new workflow drafts are saved directly by propose_workflow
  -> saved workflows run through run_workflow or a named /workflow command
```

When authoring a workflow, the agent should think roughly:

```text
read the user's goal
if an existing workflow fits:
  call run_workflow(name, input)
else:
  call workflow_design_guidance({ topic: "overview" }) before authoring, then narrower topics only as needed
  draft a complete workflow directory under the default outside-project draft root from the current session prompt
  put reusable child-agent prompt templates in prompts/*.txt and render them with renderPrompt
  include workflow.js metadata { name, description, inputInstructions, phases }
  document workflow(input) with JSDoc:
    purpose, input fields/defaults, phases, child agents, file reads, result
  call propose_workflow with draftDir pointing at the directory, not workflow.js
```

When running an existing named workflow:

```text
/workflow:name {json} or key=value input
  -> parse at command boundary
  -> validate required fields from workflow function JSDoc/signature
  -> run immediately or show a missing-arg message

/workflow:name freeform natural language
  -> do NOT start a hidden resolver agent
  -> inject a visible message into the current conversation
  -> the agent sees metadata.inputInstructions, workflow(input) contract, source, and user text
  -> the agent asks the human if required input is missing/ambiguous
  -> the agent calls run_workflow only once input is complete
```

The workflow agent sees only what the workflow prompt gives it. Phases are progress markers, not shared memory. If one child agent needs another child agent's output, the workflow must explicitly include that output in the later prompt.

## Code organization

- `extensions/`: pi command, tool, and TUI wiring. Parse/coerce user input here.
- `src/`: testable workflow orchestration logic. Accept normalized inputs here.
- `src/display/`: every TUI or visible text renderer lives in a focused display module.
- `src/authoring-guide.ts`: on-demand workflow design guidance returned by `workflow_design_guidance`. Keep this synchronized with authoring conventions because workflow-authoring agents request it when needed.
- `src/prompts/`: raw prompt text files only; TypeScript interpolation lives outside this directory.
- `tests/`: deterministic `node:test` coverage with fake agents only.
- `docs/specs/`: workflow system design notes.
- `agent_docs/INDEX.md`: agent-facing coding rules and repository map.

## Key data shapes

TypeScript interfaces/types are the source of truth:

- `src/runtime/types.ts`: `WorkflowMetadata`, `WorkflowAgentOptions`, `WorkflowAgent`, `WorkflowSnapshot`, `RunWorkflowOptions`, `WorkflowRunResult`.
- `src/runtime/run.ts`: workflow execution wiring.
- `src/workflow/paths.ts`: workflow name/path/cwd resolution.
- `src/workflow/sandbox.ts`: sandbox module transform and import/require bans.
- `src/workflow/metadata.ts`: static `export const metadata = { ... }` parsing.
- `src/request.ts`: `GeneratedWorkflowDraft` validation and draft saving.
- `src/discovery.ts`: `WorkflowReference`.
- `src/tools.ts`: `WorkflowToolsOptions`.
- `src/pi-agent.ts`: `PiWorkflowAgentOptions`.

## Coding standards

- Keep the extension small and dependency-light.
- Keep command/UI parsing at boundaries; keep core runtime strict.
- Keep prompt copy in raw `.txt` files under `src/prompts/`.
- Keep workflow authoring guidance in TypeScript and serve it on demand through `workflow_design_guidance`; do not eagerly inject the full guide into routing prompts.
- Let `readText`/`readJson` and `writeText`/`writeJson` use absolute paths, project-cwd-relative paths, and `@workflow/...` paths; use `renderPrompt` for prompt templates under the workflow's own `prompts/` directory.
- Let `agent(prompt, { cwd })` launch child agents from alternate/scratch directories; resolve relative `cwd` values from the workflow project cwd.
- Keep workflow child-agent SDK sessions isolated from ambient pi extensions by default; load only `workflow.childAgentExtensions` from merged global/project settings so parent-session extension tools/hooks cannot mutate global extension state.
- Agent-generated workflows should be drafted under the default outside-project draft root from the current session prompt, so workflow authoring does not dirty the worktree. When using that default location, call `propose_workflow` with the workflow name and omit `draftDir`; use `draftDir` only for an explicit alternate directory, and point it at the directory, not the `workflow.js` file.
- Agent-generated workflow source must include required `metadata.phases` as the planned runbook outline and document the default workflow function with JSDoc covering purpose, input fields/defaults, phases, child agent usage, file reads, and result shape.
- Optimize workflow authoring for power-user/agent-authored executable runbooks: top-level constants, inline schemas, prompt-builder helpers, and local paths are fine when they improve observability and ease of tweaking.
- Generated workflow saves are direct: `propose_workflow` validates a complete draft directory and copies it to `.pi/workflows/<name>/` in one call.
- Generated workflow child-agent prompts must be self-contained expert task packets: include mission, source-of-truth paths, prior results, non-negotiable invariants, concrete commands/search strategies, evidence requirements, pass/fail gates, and exact artifacts to read or write.
- Shared prompt context is allowed, but format it as a compact contract (`Inputs`, `Purpose`, `Definitions`, `Rules`, `Task`, `Output`) instead of an unstructured global preamble dump; omit irrelevant globals for that stage.
- Put reusable generated-workflow child-agent prompt templates in the workflow draft's `prompts/*.txt` files, use `{{name}}` placeholders, and render them with `renderPrompt`; reserve inline prompts for tiny one-off glue.
- Use adversarial verifier/repair stages for important generated artifacts only when the risk justifies the extra agents; verifier prompts should cite evidence and separate major correctness failures from recommendations.
- Prefer `agent(prompt, { schema, maxAttempts? })` for structured child-agent work; use `log(message)` for visible workflow milestones and `trace(label, value?)` for workflow-local structured debug state that should show up in snapshots/session summaries.
- Keep running-workflow TUI behavior shared between named workflow commands, current-session `run_workflow` tool calls, `/view-workflow` inspector entry, and reload reattachment.
- Give every function a clear job; inline short helpers that only hide one expression or rename a local concept.
- Prefer simple functions over managers, frameworks, or class hierarchies.
- Inject agents; never call real models from tests.
- Use deterministic fake agents in tests.
- Keep strict ESLint and Prettier clean; Husky runs lint-staged on pre-commit.
- Add or update tests with behavior changes.
- Update `README.md`, `docs/`, `agent_docs/`, and relevant `AGENTS.md` in the same change when guidance or behavior shifts.
