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

JSON, `key=value`, `--key value`, and comma-separated lists run directly.
Freeform workflow requests stay visible in the current chat for the agent to
resolve before calling `run_workflow`.

When a workflow finishes, pi-workflow posts the final result or report, keeps
the output paths visible, and asks the current agent to review and summarize the
result for you.

## TUI

Running workflows show a compact widget below the editor. Press `Down` on an
empty prompt to select it, `Enter` to inspect, and `Esc` or `Up` to return.

```text
  ↓ select (on an empty prompt) to inspect
  ◐ review  reviewing src/auth.ts and tests/auth.test.ts        2/5 agents done · 1m12s · ↓18.4k tokens
```

A passive project monitor also appears below the editor for workflows active in
other Pi sessions for the same project. Use `/workflow-status [--json] [--all]
[latest|<ref>]` or the `workflow_status` tool for compact status without knowing
the output directory.

Inspector view:

```text
 review                                                       2/5 agents · 1m12s
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
code runs in a sandbox with globals such as `agent`, `parallel`, `pipeline`,
`mapreduce`, `verifier`, `phase`, `log`, `trace`, and file helpers.
Reusable child prompts live in `prompts/*.txt` and launch through
`agent({ template, values }, options)`; `renderPrompt` remains available for
exceptional composition.

`agent`, `mapreduce`, and `verifier` accept `extensions` and `tools`
string lists. Omit either list to inherit workflow settings; use `[]` for none.
Naming an extension-owned tool loads its extension while keeping the tool list
exact.

Pass an object JSON Schema as `agent(..., { schema })` when a child must return
structured fields. The runtime prepends the schema and exposes a terminal
`StructuredOutput` tool whose keyword arguments are validated by Pi. Calling it
ends the child; results always include `message`, `name`, `steps`, and standard
token `usage` metadata.

Agents can call `workflow_design_guidance` for focused authoring help. Its
primitive reference is generated from the runtime primitive registry so supported
globals stay synchronized with implementation. Agents call `propose_workflow` to
save complete generated workflow draft directories and `workflow_status` to check
active project workflow progress. `propose_workflow` validates child-agent
capabilities against Pi's installed extensions and tools before saving.

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
