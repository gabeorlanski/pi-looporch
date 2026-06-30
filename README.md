# pi-workflow

A small pi extension for code-first project workflows.

Use it when a repo has repeatable agent work: review a set of files, fan out across
tasks, synthesize findings, generate artifacts, or run a custom checklist. Workflows
are plain JavaScript files in your project, so you can inspect and edit the runbook.

## Install

From this checkout:

```bash
pi install /path/to/pi-workflow
```

For local development:

```bash
npm install
npm run check
pi -e ./extensions/workflow.ts
```

## Run A Workflow

Saved workflows live under `.pi/workflows/<name>/workflow.js`.

```text
/workflow <name> [input]
/workflow:<name> [input]
/workflow <natural-language request>
```

Examples:

```text
/workflow count-to-target target=10
/workflow:review files=src/index.ts,tests/index.test.ts
/workflow:review prompt="focus on auth edge cases" files=src/auth.ts
/workflow review the auth flow and create a reusable workflow if needed
```

JSON, `key=value`, `--key value`, and comma-separated lists run directly. Freeform
named-workflow input stays visible in the current chat so the agent can ask for
missing fields before starting the workflow.

## What The TUI Looks Like

While a workflow runs, pi shows a compact widget below the editor. Press `Down` on
an empty prompt to select it, `Enter` to open the inspector, and `Esc` or `Up` to
return to the prompt.

```text
  ↓ select (on an empty prompt) to inspect
  ◐ review  reviewing src/auth.ts and tests/auth.test.ts        2/5 agents done · 1m12s · ↓18.4k tokens
```

The inspector shows phases on the left and child agents on the right.

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

The live UI stays compact. Full prompts, child-agent transcripts, tool results, and
workflow outputs are written to session logs and output files instead of being
dumped into the chat.

## Write A Workflow

Create one directory per workflow:

```text
.pi/workflows/<workflow-name>/
  workflow.js
  prompts/
```

`workflow.js` exports static metadata and a default async function:

```js
export const metadata = {
  name: "review",
  description: "Review files in parallel and synthesize findings",
  inputInstructions: "Resolve explicit paths as files. Treat remaining prose as focus.",
  phases: [
    { title: "fanout", detail: "review each file independently" },
    { title: "synthesis", detail: "combine findings" },
  ],
};

/**
 * Purpose: review files in parallel and synthesize findings.
 * Input: files is required; focus defaults to a general review.
 * Phase: fanout reviews each file, synthesis combines findings.
 * Agent: launches one child agent per file and one synthesis agent.
 * Result: returns the synthesis response.
 * @param {object} input
 * @param {string[]} input.files - Files to review.
 * @param {string} [input.focus="general review"] - Optional focus.
 */
export default async function workflow({ files, focus = "general review" }) {
  phase("fanout");
  const reviews = await parallel(
    files,
    (file) =>
      agent(renderPrompt("review.txt", { file, focus }), {
        label: file,
        reasoning: "minimal",
        taskFile: file,
      }),
    { label: "file reviews", reduction: "synthesize reviews" },
  );

  phase("synthesis");
  const reviewText = JSON.stringify(reviews).slice(0, 8000);
  return agent("Synthesize these reviews:\n\n" + reviewText, {
    label: "synthesis",
    reasoning: "minimal",
  });
}
```

Workflow code runs in a sandbox. It receives the workflow input as the function
argument and uses these globals:

```text
agent, parallel, pipeline, coerce, mapreduce, verifier, phase, log, trace,
cwd, budget, readText, readJson, renderPrompt
```

Use `renderPrompt("review.txt", values)` for files under the workflow's
`prompts/` directory. Use `readText` and `readJson` for project files, absolute
paths, and `@workflow/...` paths.

## Settings

Project settings live in `.pi/settings.json`. Global settings can live in
`~/.pi/agent/settings.json`; project settings win.

```json
{
  "workflow": {
    "maxParallelAgents": 4,
    "childAgentExtensions": ["pi-subagents", "./extensions/todo.ts"]
  }
}
```

Commands:

```text
/workflow-settings
/workflow-settings maxParallelAgents=8
/workflow-settings childAgentExtensions=pi-subagents,./extensions/todo.ts
/workflow-settings --global maxParallelAgents=4
```

Child agents load only `workflow.childAgentExtensions`, so parent-session
extensions do not leak into workflow runs unless you opt in.

## Review A Run

When a workflow completes, pi prints the final result path and workflow session-log
directory. Review the latest run with:

```text
/workflow-review latest
```

`/workflow-review` reads the recorded workflow logs and reports token spend,
repeated tool activity, common commands, and concrete cost-reduction targets.

## Development

```bash
npm run lint          # strict ESLint
npm run lint:fix      # auto-fix lint violations
npm run format        # Prettier write
npm run format:check  # Prettier check
npm run docs:check    # exported API docstrings and docs-sync contracts
npm run typecheck     # TypeScript without emit
npm test              # deterministic node:test suite
npm run loadcheck     # verify pi can load the extension
npm run check         # full gate
```

Tests use deterministic fake agents only.
