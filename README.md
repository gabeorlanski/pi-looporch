# pi-workflow

A small pi extension for running project-local workflows with agent orchestration primitives.

## Install in pi

From this checkout:

```bash
pi install /path/to/pi-workflow
```

For development:

```bash
npm install
npm run check
pi -e ./extensions/workflow.ts
```

## Workflow layout

Workflows live in one directory per workflow:

```text
.pi/workflows/<workflow-name>/
  workflow.js  # required executable workflow and metadata
  prompts/     # optional renderPrompt templates
  ...          # optional schemas, fixtures, examples, and @workflow readText/readJson files
```

You can also point a project at external workflow directories with `.pi/settings.json`:

```json
{
  "workflow": {
    "workflowDirs": ["../shared-workflows", "/absolute/path/to/workflow-library"]
  }
}
```

Each entry is a workflow root containing `<workflow-name>/workflow.js` children. Relative paths resolve from the project root. Project-local `.pi/workflows` is always searched first.

Workflow child-agent launches are globally capped by `.pi/settings.json`; fan-outs and direct concurrent `agent(...)` calls queue extra agents until a slot opens. The default cap is 4 concurrent agents. Configure it with `/workflow-settings` in the TUI or edit JSON directly:

```json
{
  "workflow": {
    "maxParallelAgents": 4
  }
}
```

## Authoring

`workflow.js` exports static object-literal metadata and a default function. `metadata.inputInstructions` tells the input resolver how to interpret natural-language command input; `metadata.phases` is the planned runbook outline shown before runtime starts; the workflow function JSDoc and parameter signature are the single argument contract. Metadata must be written directly as `export const metadata = { ... }` with JSON-like literals so discovery can parse it without executing workflow code. Workflows are optimized for power-user/agent authoring, so top-level constants, inline schemas, prompt-builder helpers, and local runbook assumptions are encouraged when they make the workflow easier to inspect and tweak. Keep helpers local and compact: use them for repeated multi-line prompt assembly, compacting handoffs, or multi-step transformations, and inline one-expression helpers or renames.

```js
export const metadata = {
  name: "review",
  description: "Review a set of files in parallel and synthesize findings",
  inputInstructions: "Resolve file paths from explicit file mentions. Treat remaining prose as the optional focus prompt.",
  phases: [
    { title: "fanout", detail: "review each file independently" },
    { title: "synthesis", detail: "combine review findings" },
  ],
};

/**
 * Purpose: review a set of files in parallel and synthesize findings.
 * Input: files is required; focus defaults to a general review.
 * Phase: fanout reviews each file, synthesis combines the findings.
 * Agent: launches one child agent per file, then one synthesis agent.
 * Result: returns the synthesis agent response.
 * @param {object} input
 * @param {string[]} input.files - Files to review.
 * @param {string} [input.focus="general review"] - Optional review focus.
 */
export default async function workflow({ files, focus = "general review" }) {
  phase("fanout");
  const reviews = await parallel(
    files,
    async (file) => {
      return agent(renderPrompt("review.txt", { file, focus }), {
        label: file,
        reasoning: "minimal",
        taskFile: file,
      });
    },
    { label: "file reviews", reduction: "synthesize reviews" },
  );

  phase("synthesis");
  return agent("Focus: " + focus + "\n\nSynthesize these compact reviews:\n" + compact(reviews, 8000), {
    label: "synthesis",
    reasoning: "minimal",
  });
}

function compact(value, max = 4000) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length <= max ? text : text.slice(0, max) + "\n… truncated";
}
```

Workflow code runs in a restricted sandbox. It receives direct globals instead of a context object: `agent`, `parallel`, `pipeline`, `coerce`, `mapreduce`, `verifier`, `phase`, `log`, `trace`, `args`, `cwd`, `budget`, `readText`, `readJson`, and `renderPrompt`. Workflow code cannot import modules or access ambient Node globals like `process`, but `readText` and `readJson` can read any file the pi process can read: absolute paths resolve as absolute, bare relative paths resolve from the project `cwd`, and `@workflow/...` resolves inside the workflow directory. New workflows should receive input through the default function parameter; the global `args` remains for compatibility. Agent-generated workflows must document the default workflow function with JSDoc covering purpose, input fields/defaults, phases, child agent usage, file reads, and result shape before they can be saved. Generated workflows should pass source-of-truth paths and contracts to child agents instead of pasting large source/docs contents; use `cwd`, `taskFile`, schemas, and evidence requirements, and paste only concise prior results.

Workflow discovery skips invalid workflow definitions so one broken `.pi/workflows/<name>/workflow.js` cannot prevent pi startup or command completion registration. Fix or remove the invalid workflow file to make it appear in `/workflow` suggestions again.

Phases are progress markers, not shared memory. Agents do not automatically receive earlier phase responses, so workflows should keep dataflow visible by storing results and rendering them into later prompts. A prior-result handoff is explicit only when the workflow renders the result text, compact summary, or artifact path into the child prompt; traces and phase history do not become child-agent context:

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

`renderPrompt(templatePath, values)` reads a prompt template from the workflow's `prompts/` directory and replaces simple `{{name}}` placeholders with values. For `.pi/workflows/review/workflow.js`, templates live under `.pi/workflows/review/prompts/`:

```txt
Review {{file}}.

Read the file yourself from the repository; source content is not pasted.
Return compact findings with file paths, line numbers, severity, and evidence.

Focus: {{focus}}
```

```js
const prompt = renderPrompt("review/base.txt", { file: args.file, focus: args.focus });
```

Use `readText` and `readJson` for plain file reads. Absolute paths resolve as absolute, bare relative paths resolve from project `cwd`, and `@workflow/...` resolves inside the workflow directory. Use `renderPrompt` for prompt templates owned by the workflow under its `prompts/` directory; `renderPrompt` remains scoped to that prompt directory.

### Structured primitives and observability

`agent(prompt, { schema, maxAttempts?, label?, model?, reasoning?, cwd?, taskFile?, tools? })` runs the child agent with the provided task, requires the final response to be JSON that validates against the schema, retries with validation feedback when needed, and returns the parsed JSON value. This is the preferred power-user style when a child agent owns both the work and the structured result contract. `cwd` optionally launches the child agent with a different working directory; absolute paths resolve as absolute, and relative paths resolve from the workflow project's `cwd`.

Treat JSON as the control surface, not the payload. Prefer compact schemas for child-agent results: required fields, short keys, enums/booleans for status, `maxLength`, `maxItems`, and `additionalProperties: false`. Return only the values downstream code branches on: status, decisions, stable IDs, counts, line references, artifact paths, evidence paths, and short summaries. Put reasoning, transcripts, reports, generated files, diffs, and bulk evidence in named files and return a compact manifest. For large lists, prefer capped summaries or JSONL/artifact files over one giant nested JSON object. If later stages need detail, first return a compact selector/manifest, then launch follow-up agents for only the selected items.

```js
const finding = await agent("Review the run. Return compact JSON only: status, <=160-char summary, and up to 3 findings.", {
  label: "review:run",
  schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pass", "fail"] },
      summary: { type: "string", maxLength: 160 },
      findings: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            line: { type: "integer", minimum: 1 },
            severity: { type: "string", enum: ["blocker", "major", "minor"] },
            message: { type: "string", maxLength: 200 },
          },
          required: ["path", "line", "severity", "message"],
          additionalProperties: false,
        },
      },
    },
    required: ["status", "summary", "findings"],
    additionalProperties: false,
  },
});
```

`log(message)` adds a concise progress note to the live workflow log. Use it before expensive child-agent launches, after important decisions or returned artifacts, and at handoff points so a running user can understand the workflow without opening transcripts. `trace(label, value?)` records workflow-local debug state in the live snapshot and run events. Use it for tweakable intermediate data such as selected files, candidate counts, normalized inputs, paths, and compact handoff summaries.

`coerce({ schema, prompt, label?, model?, reasoning?, maxAttempts? })` runs a no-tools child agent until its response parses as JSON and validates against the JSON Schema. Use it for pure extraction/normalization tasks where the child agent does not need tools. Keep extraction schemas bounded with `maxLength`, `maxItems`, and `additionalProperties: false` so coercion produces small normalized values rather than verbose prose.

`mapreduce({ inputPrompt, mapPrompt, reducePrompt, label?, model?, reasoning?, maxAttempts?, ...templateValues })` coerces `inputPrompt` into `{ items: [...] }`, runs one map agent per item, then runs one reduce agent. String prompts can use `{{item}}`, `{{index}}`, `{{results}}`, and any extra template values. Before map/reduce fan-out, select and cap the input set; keep map and reduce outputs compact.

`verifier({ criteria, criteriaPrompt, reducePrompt, label?, model?, reasoning?, ...templateValues })` runs one voter agent per criterion voter and then reduces the votes. Each criterion must include `name`, `description`, `guidelines`, `reasoning`, and optional `voters`. Prefer one verifier voter unless deeper review is explicitly required.

For large generated outputs, route content to files. Prompts should name exact output paths; schemas should require `artifactPaths` and a concise `summary`/`status`; final workflow results, traces, and logs should include paths rather than full artifact contents. Use stable IDs and lookup tables when many findings share the same long file names, commands, or criteria, so JSON entries can refer to IDs instead of repeating strings.

Current-session agents can call `workflow_design_guidance` for concise topic-specific workflow design help, `debug_workflow` to run a small workflow draft in a temporary sandbox with fake child-agent responses, or `propose_workflow` to submit a new draft workflow directory. Workflow child agents get the normal coding tool surface by default, not workflow-authoring tools; pass `tools: false` for structured no-tool calls. `workflow_design_guidance` returns a short topic index by default; agents should start with `topic: "overview"`, then request narrower topics such as `workflow-api`, `prompt-files`, `structured-outputs`, or `fanout` only when needed. `debug_workflow` is for controlled checks only: keep snippets simple, pass fake `agentResponses`, and prefer minimal/low-thinking model labels. Generated workflows are review-gated. Agents should write complete draft directories under a project-local path such as `.pi/workflow-drafts/<name>/` with `workflow.js` plus any `prompts/`, schemas, fixtures, or assets, then call `propose_workflow` with `draftDir` pointing at that directory, not the `workflow.js` file. Inline `source` remains available only for very small workflows with no resource files. Pi shows a natural-language proposal before copying the approved draft directory to `.pi/workflows/<name>/`, and reviewer-updated `workflow.js` source plus workflow-local resources are what get saved.

Generated workflows should encode expert runbook judgment in their child-agent prompts, not just wire primitives together. Strong workflow prompts are concise task packets: they name the mission, source-of-truth paths, only the relevant prior results or compact summaries, non-negotiable invariants, pass/fail gates, commands or search strategies, evidence requirements, exact artifact paths to read or write, and an output contract. Shared context is welcome, but format it as a compact prompt-file contract such as `Inputs`, `Purpose`, `Definitions`, `Rules`, `Task`, and `Output`; avoid unstructured global preamble dumps and repeated irrelevant globals. Put reusable child-agent prompt templates in `prompts/*.txt`, use `{{name}}` placeholders, and render them with `renderPrompt(...)` from `workflow.js`; reserve inline prompts for tiny one-off glue. Prefer paths, `taskFile`, `cwd`, and search instructions over embedded bulk content; return artifact paths plus compact summary/status for large outputs. When the default `workflow()` function returns a string, pi-workflow treats that string as the parent-agent handoff: `run_workflow` returns it to the calling orchestrator, and direct slash-command runs inject it back into the current session agent as a hidden follow-up while still showing the normal completion message. Use string returns for concise instructions or synthesis packets meant for the overall parent agent; use object returns for machine-readable results that should stay in logs/tool details. Use adversarial verifier/repair stages only for high-risk or artifact-producing workflows, default to one voter and one bounded repair pass, and skip optional assurance stages when `budget.agentCount`/`budget.tokenCount` show the run is already expensive.

## Commands

```text
/workflow <workflow-name> [--save-log] [input]
/workflow:<workflow-name> [--save-log] [input]
/workflow <natural-language request>
/workflow-review <workflow-name>
/workflow-settings [maxParallelAgents=<positive-integer>]
```

Examples:

```text
/workflow count-to-target target=10
/workflow:review files=src/index.ts,tests/index.test.ts
/workflow:review prompt="focus on auth edge cases" files=src/auth.ts,tests/auth.test.ts
/workflow review the auth flow and create a reusable workflow if needed
/workflow-review review
/workflow-settings maxParallelAgents=8
```

Named workflow commands (`/workflow <name>` and `/workflow:<name>`) run the saved workflow directly for JSON and `key=value`/`--key value` input. Freeform named-workflow input is sent into the current session as a normal visible, steerable conversation: pi-workflow displays a compact prompt with `metadata.inputInstructions`, the planned `metadata.phases`, the workflow function JSDoc/signature contract, and the user's input. The agent asks if required fields are missing and calls `run_workflow` only when the input is complete. Missing required args in direct JSON/key-value calls produce an actionable message instead of starting the workflow and crashing. Every child agent launched for a workflow stores logs under `~/.pi/agent/sessions/<project-key>/<parent-run-id>/<agent-key>/`, with `metadata.json`, in-flight `events.jsonl`, and the pi session JSONL. Token counts are never estimated; pi-workflow reports provider usage from events/session JSONL when available. Pass `--save-log` to also save the workflow-level debugging trajectory under `.pi/workflow-runs/<parent-run-id>/` with `metadata.json`, `input.json`, `workflow.js`, `events.jsonl`, `final-snapshot.json`, and the final `result.json` or `error.json`. On completion, pi-workflow posts a capped result preview plus the workflow session-log directory; that directory contains `workflow-summary.json` with planned phases, runtime phases, traces, runtime messages, fan-outs, and child-agent directories whose slugs include phase, fan-out, agent id, and label for searchable follow-up analysis. If the default `workflow()` returns a string during a direct slash-command run, pi-workflow also injects that string as a hidden parent-agent handoff and triggers the current session agent; non-string results remain preview/log data only. While a workflow is running in the TUI, pi-workflow shows a compact `args ...` preview of the normalized run input, phase history, expanded active phase children, collapsed completed phases, model, thinking, input tokens, assistant output tokens, tool calls, and NET totals, plus a mini terminal-style runtime log where trace lines used to appear. The runtime log auto-records child-agent tool names such as `bash` or `read`; detailed tool progress stays in counters and transcripts loaded from child session logs rather than being copied through workflow snapshots. The runtime log wraps long messages and uses compact phase or agent prefixes such as `[P2]` or `[A3]`. Press `Ctrl+\\` (or `F2` / legacy `Alt-O`) to split the running workflow view into a tmux-style progress/transcript pane; use arrows/PageUp/PageDown to scroll, Tab or left/right to switch agents, and Esc/q/Ctrl+\\ to close the transcript pane without aborting the workflow.

## Development

```bash
npm run lint          # strict ESLint
npm run lint:fix      # auto-fix lint violations
npm run format        # Prettier write
npm run format:check  # Prettier check
npm run typecheck     # TypeScript without emit
npm test              # deterministic node:test suite
npm run loadcheck     # verify pi can load the extension
npm run check         # full gate
```

Pre-commit hooks run `lint-staged` through Husky after `npm install`/`npm run prepare`.

Tests use deterministic fake agents only; they do not call real models.
