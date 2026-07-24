# pi-workflow

A small pi extension for code-first project workflows.

Use it when a repo has repeatable agent work: review files, fan out across tasks,
synthesize findings, generate artifacts, or run a custom checklist. Workflows are
plain JavaScript files under `.pi/workflows/<name>/workflow.js`.

## Install

```bash
pi install /path/to/pi-workflow
```

For local development:

```bash
npm install
npm run check
pi -e ./extensions/workflow.ts
```

## Run

```text
/workflow <name> [input]
/workflow:<name> [input]
/workflow <natural-language request>
/view-workflow
/workflow-status
/workflow-review latest
```

Examples:

```text
/workflow count-to-target target=10
/workflow:review files=src/index.ts,tests/index.test.ts
/workflow review the auth flow and create a reusable workflow if needed
```

Complete JSON, `key=value`, `--key value`, and comma-separated lists run directly.
Freeform or incomplete named-workflow input stays visible in the current chat for
the agent to resolve before calling `run_workflow`; it does not create a workflow
run or a resumable failure.

When a workflow finishes, pi-workflow posts the final result or report, keeps
the output paths visible, and asks the current agent to review and summarize the
result for you.

`run_workflow` returns a run ID. If that run fails or is aborted, the current
agent can call `resume_workflow` with the ID. Resume replays the current workflow
source with its original input, returns unchanged completed `agent` and `LLM`
calls from the run cache, and executes normally from the first changed or
incomplete call. Resume is available only in the same live Pi session.

## TUI

Running workflows show a compact widget below the editor. Press `Down` on an
empty prompt to select it, `Enter` to inspect, and `Esc` or `Up` to return.

```text
  ↓ ◐ workflow review  reviewing src/auth.ts and tests/auth.test.ts
    2/5 agents done · 1m12s · in 18.4k · cached 12k · out 2.1k · $0.12
```

The active-workflow widget and inspector header show totals for the selected workflow.
A trailing `+` means at least one observed provider response did not report a price.

A passive project monitor also appears below the editor for workflows active in
other Pi sessions for the same project. Use `/workflow-status [--json] [--all]
[latest|<ref>]` or the `workflow_status` tool for compact status without knowing
the output directory.

Inspector view:

```text
 review                    2/5 agents · 1m12s · in 18.4k · cached 12k · out 2.1k · $0.12
 reviewing src/auth.ts and tests/auth.test.ts

┌ Phases ───────────────┐┌ fanout · 4 agents ─────────────────────────────────────┐
│›◐ fanout          2/4 ││✔ src/auth.ts              gpt-5-mini  5.2k tok · 8 tools│
│  2 synthesis      0/1 ││✔ tests/auth.test.ts       gpt-5-mini  3.1k tok · 4 tools│
│  3 final          0/0 ││◐ src/session.ts           gpt-5-mini  2.4k tok · 3 tools│
│                      ││✗ docs/auth.md             gpt-5-mini  1.1k tok · 1 tools│
└──────────────────────┘└────────────────────────────────────────────────────────┘
 ↕ select · → agents · x abort workflow · esc back · s snapshot path
```

## Write

A workflow directory contains `workflow.js` and optional prompt files:

```text
.pi/workflows/<workflow-name>/
  workflow.js
  prompts/
```

`workflow.js` exports static `metadata` and a default async function. Workflow
code runs in a sandbox with globals such as `LLM`, `agent`, `parallel`, `pipeline`,
`mapreduce`, `verifier`, `phase`, `log`, `trace`, and file helpers.
Reusable child prompts live in `prompts/*.txt` and launch through
`agent({ template, values }, options)`; `renderPrompt` remains available for
exceptional composition. Write prompts as compact task packets: goal, exact
sources to read, work to perform, artifact or value to deliver, and the evidence
that means the task is done. Use Markdown or plain text by default. Use one
of a few descriptive XML wrappers only when complex variable data would otherwise
blur into instructions; do not tag headings, rules, sentences, or output fields
or build nested tag taxonomies.
Tags are delimiters, not a security boundary. For machine-readable results,
prefer `schema` and `StructuredOutput`. The runtime uses stable top-level
`<workflow_instructions>`, `<workflow_task>`, and `<workflow_context>` sections
to separate provenance, the rendered task, and escaped metadata. Schema-enabled
agents also receive `<structured_output_contract>` and
`<structured_output_schema>` sections. Do not reuse those names in child prompt
files.

`agent`, `mapreduce`, and `verifier` accept `extensions` and `tools`
string lists. Omit either list to inherit workflow settings; use `[]` for none.
Naming an extension-owned tool loads its extension while keeping the tool list
exact.

Pass an object JSON Schema as `agent(..., { schema })` when a child must return
structured fields. The runtime prepends the schema and exposes a terminal
`StructuredOutput` tool whose keyword arguments are validated by Pi. Calling it
ends the child; results always include `message`, `name`, `steps`, and standard
token `usage` metadata.

Use `LLM(prompt, options?)` for one generation-only call with Pi's active model
and authentication. Options include `model`, `reasoning`, `system`, ordered prior
`messages`, and an object `schema`. The prompt is appended as the final user
message, then Pi passes the complete message list to the selected model API for
provider-specific formatting. Omit `model` to use the active model.
Results have `{ text, output, usage, model, provider, stopReason }`, with
validated JSON in schema-call `output` and `null` otherwise. `LLM` has no tools,
agent session, repair request, or child-agent concurrency cost. Direct calls
appear in the workflow Inspector with their prompt, output, status, model, and
provider-reported usage; that usage contributes to workflow token and cost totals.

```js
const result = await LLM("Classify this release.", {
  model: "anthropic/claude-sonnet-4-5",
  reasoning: "high",
  system: "Return a concise assessment.",
  messages: [{ role: "user", content: "The previous release was stable." }],
  schema: {
    type: "object",
    properties: { stable: { type: "boolean" }, summary: { type: "string" } },
    required: ["stable", "summary"],
    additionalProperties: false,
  },
});
```

Agents can call `workflow_design_guidance` for focused authoring help. Its
primitive reference is generated from the runtime primitive registry so supported
globals stay synchronized with implementation. Agents call `propose_workflow` to
save complete generated workflow draft directories and `workflow_status` to check
active project workflow progress. `propose_workflow` validates child-agent
capabilities against Pi's installed extensions and tools before saving.

Workflow outputs and resume caches live under
`/tmp/pi-looporch/<project-slug>/<session-id>/runs/<run-id>/` and are removed
when the session ends. Canonical child-agent transcripts remain in Pi's normal
session store.

## Settings

Project settings live in `.pi/settings.json`; global settings can live in
`~/.pi/agent/settings.json`.

```json
{
  "workflow": {
    "workflowDirs": ["../shared-workflows"],
    "maxParallelAgents": 4,
    "childAgentExtensions": ["pi-subagents", "./extensions/todo.ts"],
    "childAgentTools": ["read", "bash", "todo_read"]
  }
}
```

Missing capability settings default to `all`; an explicit empty list means
none. Per-agent lists override these defaults.

```text
/workflow-settings
/workflow-settings workflowDirs=../shared-workflows
/workflow-settings maxParallelAgents=8
/workflow-settings childAgentExtensions=pi-subagents,./extensions/todo.ts
/workflow-settings childAgentTools=read,bash,todo_read
/workflow-settings childAgentExtensions=all
/workflow-settings childAgentTools=
/workflow-settings --global maxParallelAgents=4
```

## Development

Development and compatibility checks target Pi SDK and TUI 0.80.8. The test suite includes a deterministic dummy-workflow E2E covering the extension command, Pi child-agent initialization, schema output, and completion handoff.

```bash
npm run lint
npm run format:check
npm run docs:check
npm run typecheck
npm test
npm run loadcheck
npm run check
```

Detailed design notes live in `docs/`; agent-facing repo guidance lives in
`agent_docs/`.
