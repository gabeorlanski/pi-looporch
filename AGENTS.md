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

`pi-workflow` is a small pi extension that lets projects run, review, and generate code-first workflows. Workflows live under `.pi/workflows/<name>/workflow.js` and use simple orchestration primitives such as `agent`, `parallel`, `pipeline`, `coerce`, `mapreduce`, `verifier`, `phase`, `log`, `trace`, `args`, `cwd`, `budget`, `readText`, `readJson`, and `renderPrompt`.

## Documentation standard

Keep these in sync with every behavior or convention change:

- `README.md`: user-facing install, usage, and examples.
- `docs/`: design specs and durable product/architecture decisions.
- `agent_docs/`: concise coding rules learned from user guidance.
- Every relevant `AGENTS.md`: instructions agents need before editing that area.

When the user gives coding guidance or pushes back on code, add a rule to `agent_docs/INDEX.md` only if it is a generalizable coding pattern. Do not record one-off preferences, task-specific notes, or stale workarounds.

## Workflow authoring and running model

Keep the mental model simple:

```text
User asks for workflow help
  -> current session agent decides: use existing workflow OR author a new one
  -> new workflow drafts are reviewed before save
  -> saved workflows run through run_workflow or a named /workflow command
```

When authoring a workflow, the agent should think roughly:

```text
read the user's goal
if an existing workflow fits:
  call run_workflow(name, input)
else:
  call workflow_primitives if syntax/details are needed
  draft .pi/workflows/<name>/workflow.js
  include metadata { name, description, inputInstructions, phases }
  document workflow(input) with JSDoc:
    purpose, input fields/defaults, phases, child agents, file reads, result
  prefer workflow({ field, optional = default }) over global args for new code
  use debug_workflow only for small deterministic checks with fake agents
  call propose_workflow so the human can review before save
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
- `src/authoring-guide.ts`: generated workflow source guidance rendered into prompt templates. Keep this synchronized with any authoring convention change because it is the primary documentation future workflow-authoring agents see.
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
- Keep workflow-local file reads in `readText`/`readJson`; use `renderPrompt` for prompt templates under the workflow's own `prompts/` directory.
- Agent-generated workflow source must include required `metadata.phases` as the planned runbook outline and document the default workflow function with JSDoc covering purpose, input fields/defaults, phases, child agent usage, file reads, and result shape.
- Optimize workflow authoring for power-user/agent-authored executable runbooks: top-level constants, inline schemas, prompt-builder helpers, and local paths are fine when they improve observability and ease of tweaking.
- Prefer `agent(prompt, { schema, maxAttempts? })` for structured child-agent work; use `trace(label, value?)` for workflow-local debug state that should show up in snapshots/run events.
- Give every function a clear job; inline short helpers that only hide one expression or rename a local concept.
- Prefer simple functions over managers, frameworks, or class hierarchies.
- Inject agents/reviewers; never call real models from tests.
- Use deterministic fake agents in tests.
- Keep strict ESLint and Prettier clean; Husky runs lint-staged on pre-commit.
- Add or update tests with behavior changes.
- Update `README.md`, `docs/`, `agent_docs/`, and relevant `AGENTS.md` in the same change when guidance or behavior shifts.
