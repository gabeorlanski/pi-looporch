# Workflow System Spec

## Status

Draft specification interview in progress.

## Context

`pi-looporch` currently provides project-local agent loops under `.pi/loops/<loop-name>/`, with optional executable `loop.js` files and slash-command entry points such as `/loop <loop-name>`.

The desired direction is to cut over from loops to first-class workflows: a better workflow system than the current `py-dynamicworkflows` approach.

The current `pi-dynamic-workflows` project provides useful starting primitives such as `agent`, `parallel`, `pipeline`, `phase`, `log`, `cwd`, and `budget`, but the overall experience still feels too constrained and opaque.

## Problem Statement

`py-dynamicworkflows` feels too constrained and opaque. The resulting agent behavior is not good enough, and users cannot easily understand, customize, or replace what is happening inside the workflow loop.

The replacement should make workflows simple to author, inspect, and modify directly. A user should be able to write their own workflow when the built-in behavior is insufficient.

## Goals

- Make workflow behavior transparent and easy to understand.
- Make custom workflow authoring simple enough to feel lightweight.
- Support straightforward map/reduce style fan-out and synthesis workflows.
- Preserve the ability to customize the underlying orchestration rather than forcing a rigid framework.
- Let an agent generate workflow code from user instructions, then save that code so users can inspect and edit it.
- Replace loop terminology and commands with first-class workflow terminology and commands.
- Make debugging and review explicit without making normal workflow execution noisy.
- Preserve the good parts of `pi-dynamic-workflows`: small, direct workflow primitives for agents, parallelism, pipelines, structured coercion, map/reduce, verification, phases, logs, arguments, working directory access, and budget visibility.

## Non-Goals

- Do not introduce a declarative YAML/JSON workflow DSL for the first version.
- Do not require a separate markdown metadata file for every workflow.
- Do not force authors to write workflows through a heavy `ctx` object if simpler primitives are available.
- Do not implement resumable workflow runs in v1. Workflow inspection uses the normal output files and Pi session logs instead of a second workflow-run log format.

## Authoring Model

Workflows should be code-first for the initial design. The primary workflow artifact should be executable code using a small set of helper primitives rather than a declarative YAML/JSON configuration.

Rationale: if an agent writes the workflow from user instructions, code is easier for the agent to produce clearly, easier for the user to inspect, and easier to save for later manual editing.

The authoring API should avoid making everything feel like `ctx.foo(...)`. Workflow helpers should be exposed as runtime globals, similar to `pi-dynamic-workflows`, rather than through a `ctx` object or explicit imports.

Initial global primitives should include at least:

- `agent(prompt, opts)`
- `parallel(thunks)`
- `pipeline(items, ...stages)`
- `phase(title)`
- `log(message)`
- `coerce({ schema, prompt, ...opts })`
- `mapreduce({ inputPrompt, mapPrompt, reducePrompt, ...opts })`
- `verifier({ criteria, criteriaPrompt, reducePrompt, ...opts })`
- `trace(label, value?)`
- `cwd`
- `budget`
- `readText(filePath)`
- `readJson(filePath)`
- `renderPrompt(templatePath, values)`

Every `workflow.js` must export static object-literal metadata with a planned phase outline. `metadata.inputInstructions` gives the resolver workflow-specific guidance without duplicating the argument list, and required `metadata.phases` makes the runbook shape visible before execution. Metadata must be written directly as `export const metadata = { ... }` with JSON-like literals so discovery can parse it without executing workflow code. The authoring model intentionally favors power-user/agent-authored runbooks over package-like shareability: inline schemas, prompt builders, top-level constants, and local paths are acceptable when they improve observability and ease of tweaking. Keep helpers local and compact: use them for repeated multi-line prompt assembly, compacting handoffs, or multi-step transformations, and inline one-expression helpers or renames. Agent-generated workflows must document the default workflow function with JSDoc that covers purpose, input fields/defaults, phases, child agent usage, file reads, and result shape:

```js
export const metadata = {
  name: "review",
  description: "Review a set of files and synthesize findings",
  inputInstructions: "Resolve explicit paths as files. Treat remaining prose as optional focus.",
  phases: [
    { title: "fanout", detail: "review each file independently" },
    { title: "synthesis", detail: "combine findings" },
  ],
};

/**
 * Purpose: review a set of files and synthesize findings.
 * Input: files is required; focus defaults to a general review.
 * Phase: fanout reviews each file, synthesis combines findings.
 * Agent: launches child review agents and one synthesis agent.
 * Result: returns the synthesis text.
 * @param {object} input
 * @param {string[]} input.files - Files to review.
 * @param {string} [input.focus="general review"] - Optional focus.
 */
export default async function workflow({ files, focus = "general review" }) {
  // ...
}
```

The workflow directory name is the command name. `metadata.name` must match the directory name. `metadata.description` is used for discovery and display. `metadata.inputInstructions` is passed to the current-session resolver when freeform named-command input needs to become workflow JSON. `metadata.phases` is a required list of `{ title, detail? }` entries used for planning; runtime `phase()` calls remain the source of actual progress.

Generated workflow quality depends on the child-agent prompts as much as on the control flow. Each child-agent prompt should be a concise task packet with the mission, source-of-truth paths, relevant prior results or compact summaries, non-negotiable invariants, concrete operating instructions, evidence requirements, pass/fail gates, exact artifact paths to read or write, and an output contract. Fan-out prompts must repeat the context their child needs because child agents do not share memory, but shared context should be shaped as a compact prompt-file contract (`Inputs`, `Purpose`, `Definitions`, `Rules`, `Task`, `Output`) rather than an unstructured global preamble dump. Use `{{name}}` placeholders in prompt files and render them with `renderPrompt(...)`; do not put JS template variables like `${input.file}` inside prompt text. Prompts should pass paths, `taskFile`, `cwd`, commands/search strategy, and schemas instead of pasted bulk content. A prior-result handoff is explicit only when the workflow renders the result text, compact summary, or artifact path into a later child prompt; traces, phase history, and final workflow results do not become parent-agent context automatically. Workflow results remain machine-readable data for output files and session logs. Important artifact-producing workflows should include adversarial review and bounded repair stages only when the risk justifies the extra agents; default to one voter and one bounded repair pass.

## Storage Layout

Project workflows should live in `.pi/workflows/<workflow-name>/`.

The only required file is:

```text
.pi/workflows/<workflow-name>/workflow.js
```

Each workflow gets a directory so it can include supporting files it needs, such as prompts, examples, schemas, fixtures, or helper modules.

Because workflows run sandboxed, support files are accessed through narrow runtime helpers instead of unrestricted imports or filesystem APIs:

```js
const prompt = readText("@workflow/prompts/review.md");
const schema = readJson("@workflow/schemas/finding.schema.json");
```

Prompt templates owned by a workflow live under the workflow's `prompts/` directory. Workflows render those templates through `renderPrompt(templatePath, values)`, which uses simple `{{name}}` placeholder substitution. Generated workflows should put reusable child-agent prompt templates in `prompts/*.txt` and call `renderPrompt(...)`; inline prompts are for tiny one-off glue only. Prompt files may include shared context when useful, but they should format it as structured sections and omit irrelevant globals for that stage. `readText` and `readJson` can read any file the pi process can read: absolute paths resolve as absolute, bare relative paths resolve from project `cwd`, and `@workflow/...` resolves inside the workflow directory. `renderPrompt` stays scoped to the workflow prompt directory. Use read helpers for workflow-owned prompts, schemas, fixtures, and small deterministic inputs; avoid bulk-reading project source just to paste it into child prompts.

Structured agent helpers stay inside the same sandbox. `agent(prompt, { schema, maxAttempts?, cwd?, taskFile?, tools? })` is the power-user path for child agents that do real work and must return a typed JSON result; the runtime wraps the task with the schema, retries with validation feedback, records validation failures as traces, and returns the parsed JSON value. `cwd` optionally launches that child agent in a different working directory; absolute paths resolve as absolute, and relative paths resolve from the workflow project's `cwd`. Treat JSON as the control surface, not the payload. Prefer compact schemas for child results: required fields, short keys, enums/booleans for status, `maxLength`, `maxItems`, and `additionalProperties: false`. Return only the values downstream code branches on: status, decisions, stable IDs, counts, line references, artifact paths, evidence paths, and short summaries. For large generated outputs, route content to files: prompts name exact output paths, schemas require `artifactPaths` plus concise `summary`/`status`, and final workflow results/traces/logs include paths rather than full artifact contents. Put reasoning, transcripts, reports, generated files, diffs, and bulk evidence in named files and return a compact manifest. For large lists, prefer capped summaries or JSONL/artifact files over one giant nested JSON object. If later stages need detail, first return a compact selector/manifest, then launch follow-up agents for only the selected items. Use stable IDs and lookup tables when many findings share the same long file names, commands, or criteria, so JSON entries can refer to IDs instead of repeating strings. `coerce` uses a no-tools child agent and JSON Schema validation retries for pure extraction; keep extraction schemas bounded. `mapreduce` first coerces an input prompt into a bare `{ items: [...] }` shape before map fan-out and reduction; select and cap items before fan-out. `verifier` validates criteria objects with `name`, `description`, `guidelines`, `reasoning`, and optional `voters`, then runs criterion voter agents before a reduction agent; prefer one voter unless deeper review is explicitly required. `log(message)` records live user-facing milestones before slow launches, after important decisions/results, and at handoffs; `trace(label, value?)` records structured workflow-local debug state for selected inputs, counts, paths, artifact paths, handoff state, and compact child-agent result summaries.

Agent-facing helper tools support workflow authoring in the current session. `workflow_design_guidance` returns concise topic-specific help so route prompts do not need to carry verbose JSON-heavy examples; agents should start with `topic: "overview"` and request narrower topics such as `workflow-api`, `prompt-files`, `structured-outputs`, `fanout`, `verification`, or `artifacts` only when needed. Workflow child agents get the normal coding tool surface by default, not workflow-authoring tools; use `tools: false` for no-tool structured calls.

A `WORKFLOW.md` file may be useful later, but it should not be required for the initial design.

## Execution Model

Saved workflows should run sandboxed with restricted JavaScript because this is safer for executable workflow code, especially when workflows may be generated by an agent.

The sandbox should preserve direct workflow primitives while limiting ambient authority. The first version should not simply execute saved workflows as unrestricted trusted project code.

Discovery is a startup and autocomplete boundary, so invalid workflow definitions must not crash pi. If a `.pi/workflows/<name>/workflow.js` file cannot be parsed for metadata or violates sandbox source rules such as the import ban, discovery skips that workflow until the file is fixed.

Phases are visible progress markers, not implicit context channels. `phase(title)` records progress history through `src/runtime/run.ts`, while `agent(prompt, opts)` launches a child agent with the provided prompt and launch metadata. If a later phase needs an earlier response, the workflow must store that result and render it, a compact summary, or an artifact path into the later prompt explicitly:

```js
export default async function workflow({ topic }) {
  phase("research");
  const research = await agent("Research " + topic, { label: "research" });

  phase("synthesis");
  return agent("Use this prior research:\n\n" + compact(research, 4000) + "\n\nWrite the final answer.", {
    label: "synthesis",
  });
}
```

Workflow runs are live by default. All child-agent launches respect workflow settings from global `~/.pi/agent/settings.json` merged with project `.pi/settings.json` (project wins). `workflow.maxParallelAgents` defaults to `4`: at most that many agents may be active across the whole workflow run, and extra `agent(...)` calls wait until a slot opens. The built-in `parallel` primitive also queues fan-out workers to avoid unbounded non-agent work; `mapreduce` and `verifier` use the same queue because their map/voter stages run through `parallel`. Workflow child-agent SDK sessions must disable ambient pi extensions by default and load only `workflow.childAgentExtensions`, so parent-session extension tools and hooks cannot mutate parent/global extension state. Configured child-agent extensions run against each child session; a todo extension configured for child agents stores child-local todo state instead of updating the parent todo list.

Every child agent launched for a workflow persists logs under `~/.pi/agent/sessions/<project-key>/<parent-run-id>/<agent-key>/`. The project key matches pi's encoded session directory naming for the current project, the parent run id is shared by all agents in the workflow run, and each agent directory includes `metadata.json`, compact append-only in-flight `events.jsonl`, and the pi session JSONL. The pi session JSONL is the canonical conversation transcript. The child-agent `events.jsonl` stream keeps runtime lifecycle metadata but drops streamed `message_update` deltas and strips conversation payloads from message lifecycle, agent completion, and tool lifecycle events, so final messages and tool results are saved once in the session JSONL rather than copied through runtime events. The final workflow completion message sent back to the main session includes the final result path and workflow session-log directory path, not result content. That directory contains `workflow-summary.json` with planned phases, runtime phases, traces, runtime messages, fan-outs, agents, and the final result path; child-agent directory slugs include phase, fan-out, agent id, and label for searchable follow-up analysis. Token counts must never be estimated; workflow progress uses provider usage from events/session JSONL when available, including provider alias fields such as `prompt_tokens` and `completion_tokens`, and otherwise leaves actual usage at zero/unknown.

The TUI progress display keeps compact status visible in a below-editor workflow widget, keeps phase history available in the inspector, and shows active/error child agents with status, model/reasoning, provider input/output tokens, tool calls, and step counts. Completed agents collapse into a count in the widget and appear by phase in the inspector. The default widget does not show the runtime log or child-agent messages. Detailed milestones, traces, and child tool transitions stay available in persisted session events and transcripts.

## Command Model

The extension should cut over from `/loop` to `/workflow`.

Named workflow invocation should use colon syntax and accept ergonomic non-JSON input:

```text
/workflow:review files=src/index.ts,tests/index.test.ts prompt="focus on auth"
```

Manual input handling should support JSON, `key=value`, `--key value`, and comma-separated lists directly. JSON and key-value inputs validate against the workflow function contract before execution and report missing required fields without starting the workflow. Freeform text should be sent into the current session as a normal steerable conversation; the agent receives `metadata.inputInstructions`, the workflow function JSDoc/signature contract, and the original input. The agent must try to resolve clear ambiguities from available project files, docs, tests, and existing workflows before asking. It should ask clarifying questions only when required input remains unknowable, multiple materially different interpretations remain plausible, or a high-impact choice would change workflow scope, behavior, or artifacts, and calls `run_workflow` only once the input is complete.

A generic workflow invocation should let the agent decide how to handle the request:

```text
/workflow <input>
```

For generic invocation, the agent is responsible for finding the correct existing workflow or making a new one when no existing workflow fits. When authoring a new workflow, it should infer the workflow purpose, inputs/defaults, phases, child-agent roles, file reads, and result shape from the user request and project context before asking, and should proceed with stated assumptions for low-risk reversible details.

Generated new workflows are saved directly from complete draft directories. `propose_workflow` validates `.pi/workflow-drafts/<name>/workflow.js` plus any workflow-local resources, then copies the directory to `.pi/workflows/<name>/` in one call. Saved workflows run through `run_workflow` or a named workflow command.

Workflow session logs have a separate cost-review command:

```text
/workflow-review [latest|<workflow-session-log-dir>|<parent-run-id>]
```

This command reviews the actual `workflow-summary.json`, child `events.jsonl`, and child session transcripts for token-cost reduction. It defaults to the latest project workflow run, reports actual token spend by agent, repeated tool activity, common bash commands across agents, and concrete ways to reduce future workflow cost. It should not inspect saved workflow source as its primary job.

Workflow runtime settings are configured with `/workflow-settings`. With no args, it posts a readable settings message with active values, storage locations, and direct edit commands. With args, `/workflow-settings maxParallelAgents=<n>` or `/workflow-settings childAgentExtensions=<extension>[,<extension>...]` writes the project `.pi/settings.json` value directly; prefix `--global` to write global `~/.pi/agent/settings.json` instead. Relative child-agent extension paths resolve from the workflow project root.

## Runtime UI

Normal TUI execution should stay lean. Named workflow commands should execute saved workflows directly rather than routing through a session-agent `run_workflow` tool call. Workflows started by named commands and workflows started by the current-session agent through the `run_workflow` tool should both show the same compact below-editor widget with workflow name, subtitle, agent counts, elapsed time, and token totals. Active runs are registered as transient per-run files under `.pi/workflow-runs/active/<run-id>.json` and deleted when the run settles; the latest live snapshot is persisted as `snapshot.json` in the workflow output directory so the widget and `/view-workflow` can reattach after extension reloads. Pressing ↓ on an empty prompt selects the widget, Enter opens a full-screen phase/agent inspector, and Esc/↑ returns to the prompt. `/view-workflow` opens that same inspector directly for the active running workflow and warns when none is running. Do not expose prompts, child agent output, workflow result content, or tool-argument previews in live snapshots, tool update details, the widget, or completion messages; outputs belong in the temp output files and transcripts belong in the child pi session JSONL. Deeper cost and transcript inspection happens through the completion paths, `/workflow-review`, and child session logs.

New-workflow saving (`propose_workflow`) is direct. Agents pass a project-local draft directory containing `workflow.js` and any workflow-local prompts/assets; the `draftDir` argument points to that directory, not to the `workflow.js` file. The tool validates the draft and copies it to `.pi/workflows/<name>/`.

## Migration Direction

Loops should be replaced with first-class workflows rather than preserved as the main user-facing concept. Existing implementation pieces may be reused internally, but the product language, docs, command names, and storage layout should move to workflows.

## Open Questions

- Should the generic `/workflow <input>` command auto-create workflows in v1 or only choose/run existing workflows?
- What runtime guarantees are required: determinism, typed inputs, artifact tracking, cancellation, parallelism, UI visibility?
- What should the first usable version support?
