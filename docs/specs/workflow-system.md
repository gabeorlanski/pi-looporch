# Workflow System Spec

## Status

Draft specification interview in progress.

## Context

`pi-looporch` currently provides project-local agent loops under `.pi/loops/<loop-name>/`, with optional executable `loop.js` files and slash-command entry points such as `/loop <loop-name>`.

The desired direction is to cut over from loops to first-class workflows: a better workflow system than the current `py-dynamicworkflows` approach.

The current `pi-dynamic-workflows` project provides useful starting primitives such as `agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, `cwd`, and `budget`, but the overall experience still feels too constrained and opaque.

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
- Do not implement resumable workflow runs in v1. Persisted run logs are optional debugging artifacts, not the default execution mode.

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
- `args`
- `cwd`
- `budget`
- `readWorkflowFile(relativePath)`
- `readWorkflowJson(relativePath)`
- `renderPrompt(templatePath, values)`

Every `workflow.js` must export small metadata. `metadata.inputInstructions` gives the resolver workflow-specific guidance without duplicating the argument list. Agent-generated workflows must document the default workflow function with JSDoc that covers purpose, input fields/defaults, phases, child agent usage, file reads, and result shape:

```js
export const metadata = {
  name: "review",
  description: "Review a set of files and synthesize findings",
  inputInstructions: "Resolve explicit paths as files. Treat remaining prose as optional focus.",
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

The workflow directory name is the command name. `metadata.name` should match the directory name or be validated against it. `metadata.description` is used for discovery, review UI, and display. `metadata.inputInstructions` is passed to the current-session resolver when freeform named-command input needs to become workflow JSON.

## Storage Layout

Project workflows should live in `.pi/workflows/<workflow-name>/`.

The only required file is:

```text
.pi/workflows/<workflow-name>/workflow.js
```

Each workflow gets a directory so it can include supporting files it needs, such as prompts, examples, schemas, fixtures, or helper modules.

Because workflows run sandboxed, support files are accessed through narrow runtime helpers instead of unrestricted imports or filesystem APIs:

```js
const prompt = readText("prompts/review.md");
const schema = readJson("schemas/finding.schema.json");
```

Prompt templates owned by a workflow live under the workflow's `prompts/` directory. Workflows render those templates through `renderPrompt(templatePath, values)`, which uses simple `{{name}}` placeholder substitution. `readText`, `readJson`, and `renderPrompt` all stay scoped to the workflow directory.

Structured agent helpers stay inside the same sandbox. `coerce` uses a no-tools child agent and JSON Schema validation retries for extraction. `mapreduce` first coerces an input prompt into a bare `{ items: [...] }` shape before map fan-out and reduction. `verifier` validates criteria objects with `name`, `description`, `guidelines`, `reasoning`, and optional `voters`, then runs criterion voter agents before a reduction agent.

Agent-facing helper tools support workflow authoring. `workflow_primitives` returns canonical primitive documentation and examples for workflow authors. `debug_workflow` runs a supplied workflow source in a temporary workflow root with fake child-agent responses, returning results, token counts, launched-agent prompts, snapshots, and errors without saving the workflow. Agents should use it only for small snippets/simple tasks with minimal or low-thinking model labels.

A `WORKFLOW.md` file may be useful later, but it should not be required for the initial design.

## Execution Model

Saved workflows should run sandboxed with restricted JavaScript because this is safer for executable workflow code, especially when workflows may be generated by an agent.

The sandbox should preserve direct workflow primitives while limiting ambient authority. The first version should not simply execute saved workflows as unrestricted trusted project code.

Discovery is a startup and autocomplete boundary, so invalid workflow definitions must not crash pi. If a `.pi/workflows/<name>/workflow.js` file cannot be parsed for metadata or violates sandbox source rules such as the import ban, discovery skips that workflow until the file is fixed.

Phases are visible progress markers, not implicit context channels. `phase(title)` records progress history in `src/runtime.ts`, while `agent(prompt, opts)` launches a child agent with the provided prompt and launch metadata. If a later phase needs an earlier response, the workflow must store that result and render it into the later prompt explicitly:

```js
phase("research");
const research = await agent("Research " + args.topic, { label: "research" });

phase("synthesis");
return agent("Use this research:\n\n" + research + "\n\nWrite the final answer.", {
  label: "synthesis",
});
```

Workflow runs are live by default. All child-agent launches respect the global `.pi/settings.json` `workflow.maxParallelAgents` cap (default `4`): at most that many agents may be active across the whole workflow run, and extra `agent(...)` calls wait until a slot opens. The built-in `parallel` primitive also queues fan-out workers to avoid unbounded non-agent work; `mapreduce` and `verifier` use the same queue because their map/voter stages run through `parallel`.

Every child agent launched for a workflow persists logs under `~/.pi/agent/sessions/<project-key>/<parent-run-id>/<agent-key>/`. The project key matches pi's encoded session directory naming for the current project, the parent run id is shared by all agents in the workflow run, and each agent directory includes `metadata.json`, append-only in-flight `events.jsonl`, and the pi session JSONL. The final workflow completion message sent back to the main session includes only the workflow session-log directory path, and pi-workflow also injects that path as a normal user message so the parent agent has it in context without bloating the custom completion entry. That directory contains `workflow-summary.json` with phases, fan-outs, agents, and result metadata; child-agent directory slugs include phase, fan-out, agent id, and label for searchable follow-up analysis. Token counts must never be estimated; workflow progress uses provider usage from events/session JSONL when available and otherwise leaves actual usage at zero/unknown.

Named slash-command runs may opt into additional workflow-level debugging logs with `--save-log`; saved logs live under `.pi/workflow-runs/<parent-run-id>/` and include run metadata, normalized input, the workflow source, append-only `events.jsonl`, a final snapshot, and either `result.json` or `error.json`. Persisted workflow logs are for inspection only and do not support resuming canceled or failed runs. The TUI progress display keeps a compact normalized-input args preview visible, keeps phase history visible, expands the active phase, collapses completed phase children, and shows model, thinking, provider input tokens, assistant output tokens, tool calls, and NET totals.

## Command Model

The extension should cut over from `/loop` to `/workflow`.

Named workflow invocation should use colon syntax and accept ergonomic non-JSON input:

```text
/workflow:review files=src/index.ts,tests/index.test.ts prompt="focus on auth"
```

Manual input handling should support JSON, `key=value`, `--key value`, and comma-separated lists directly. The named-command flag `--save-log` is reserved by the slash command and stripped before workflow input parsing. JSON and key-value inputs validate against the workflow function contract before execution and report missing required fields without starting the workflow. Freeform text should be sent into the current session as a normal steerable conversation; the agent receives `metadata.inputInstructions`, the workflow function JSDoc/signature contract, and the original input, asks clarifying questions if required fields are missing, and calls `run_workflow` only once the input is complete.

A generic workflow invocation should let the agent decide how to handle the request:

```text
/workflow <input>
```

For generic invocation, the agent is responsible for finding the correct existing workflow or making a new one when no existing workflow fits.

Generated new workflows must require user review before they are saved or run.

Existing workflows should have a separate review/debug command:

```text
/workflow-review:<workflow-name>
```

This command should open a Glimpse/browser-style UI for inspecting or monitoring the workflow for debugging.

Workflow runtime settings are configured with `/workflow-settings`. With no args in TUI mode, it opens an interactive settings list. With args, `/workflow-settings maxParallelAgents=<n>` writes the project `.pi/settings.json` value directly.

## Runtime UI

Normal TUI execution should stay lean. Named workflow commands should execute saved workflows directly rather than routing through a session-agent `run_workflow` tool call. While a workflow runs, show a compact phase/agent tree with progress and token totals. Do not expose child agent output in the default running view. Pressing `Ctrl+\\` while a workflow runs toggles a tmux-style split view: the workflow progress pane remains visible alongside a transcript pane for the selected child agent. `F2` and `Alt-O` remain fallback bindings for users who already learned them, but `Ctrl+\\` is the advertised binding because macOS often reserves F-keys for hardware controls and Option combos can emit composed characters instead of Alt/meta escape sequences. The transcript pane identifies the selected agent (`agent i/n · #id label`) with its phase, status, model/thinking, tokens, and fan-out membership, and below it renders the agent's actual conversation with pi's own message components (`AssistantMessageComponent`, `ToolExecutionComponent`, `UserMessageComponent`) — the same markdown, thinking blocks, and tool call/result rendering as the main chat view. The child-agent session messages travel on the live snapshot, so the transcript updates as the run progresses. `◂`/`▸` (or Tab) cycle agents, `↑`/`↓`/PageUp/PageDown scroll the transcript, and Esc/q/Ctrl+\\/F2/Alt-O closes the transcript pane without aborting the workflow.

New-workflow approval (`propose_workflow`) opens an in-terminal TUI review overlay. It statically parses the generated `workflow.js` into a navigable outline of phases, stages, and the actual prompts each stage sends, and surfaces each stage's runtime surface (kind, model, thinking/reasoning level, prompt source). Reviewers move through the tree with `↑`/`↓`, expand or collapse phases and stages with `Space`/`←`/`→`, and expand a prompt to read its full text inline. Review is comment-driven: `c` attaches a targeted note to the selected stage or prompt, `g` records a general comment, and `r` ("request changes") sends those notes back to the agent as a structured change request. `a` approves and saves the workflow; `t` drops to the plain in-terminal text approval; `Esc` cancels. The text approval (`approvalLines`) remains as the fallback path when the session is not a TUI or the reviewer presses `t`.

## Migration Direction

Loops should be replaced with first-class workflows rather than preserved as the main user-facing concept. Existing implementation pieces may be reused internally, but the product language, docs, command names, and storage layout should move to workflows.

## Open Questions

- What should `/workflow-review:<workflow-name>` show and allow editing?
- Should the generic `/workflow <input>` command auto-create workflows in v1 or only choose/run existing workflows?
- What runtime guarantees are required: determinism, typed inputs, artifact tracking, cancellation, parallelism, UI visibility?
- What should the first usable version support?
