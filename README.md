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
  ...          # optional schemas, fixtures, examples, and readText/readJson support files
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

## Authoring

`workflow.js` exports required metadata and a default function. `metadata.inputInstructions` tells the input resolver how to interpret natural-language command input; the workflow function JSDoc and parameter signature are the single argument contract.

```js
export const metadata = {
  name: "review",
  description: "Review a set of files in parallel and synthesize findings",
  inputInstructions: "Resolve file paths from explicit file mentions. Treat remaining prose as the optional focus prompt.",
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
      return agent(readText("prompts/review.txt") + "\n\nFile: " + file, {
        label: file,
        reasoning: "high",
        taskFile: file,
      });
    },
    { label: "file reviews", reduction: "synthesize reviews" },
  );

  phase("synthesis");
  return agent("Focus: " + focus + "\n\nSynthesize these reviews:\n" + reviews.join("\n\n"), {
    label: "synthesis",
    reasoning: "medium",
  });
}
```

Workflow code runs in a restricted sandbox. It receives direct globals instead of a context object: `agent`, `parallel`, `pipeline`, `coerce`, `mapreduce`, `verifier`, `phase`, `log`, `args`, `cwd`, `budget`, `readText`, `readJson`, and `renderPrompt`. Workflow-local file helpers are constrained to the workflow directory. New workflows should receive input through the default function parameter; the global `args` remains for compatibility. Agent-generated workflows must document the default workflow function with JSDoc covering purpose, input fields/defaults, phases, child agent usage, file reads, and result shape before they can be saved.

Workflow discovery skips invalid workflow definitions so one broken `.pi/workflows/<name>/workflow.js` cannot prevent pi startup or command completion registration. Fix or remove the invalid workflow file to make it appear in `/workflow` suggestions again.

Phases are progress markers, not shared memory. Agents do not automatically receive earlier phase responses, so workflows should keep dataflow visible by storing results and rendering them into later prompts:

```js
phase("research");
const research = await agent("Research " + args.topic, { label: "research" });

phase("synthesis");
return agent("Use this research:\n\n" + research + "\n\nWrite the final answer.", {
  label: "synthesis",
});
```

`renderPrompt(templatePath, values)` reads a prompt template from the workflow's `prompts/` directory and replaces simple `{{name}}` placeholders with values. For `.pi/workflows/review/workflow.js`, templates live under `.pi/workflows/review/prompts/`:

```txt
Review {{file}}.

Focus: {{focus}}
```

```js
const prompt = renderPrompt("review/base.txt", { file: args.file, focus: args.focus });
```

Use `readText` and `readJson` for support files inside the workflow directory. Use `renderPrompt` for prompt templates owned by the workflow under its `prompts/` directory.

### Structured primitives

`coerce({ schema, prompt, label?, model?, reasoning?, maxAttempts? })` runs a no-tools child agent until its response parses as JSON and validates against the JSON Schema.

`mapreduce({ inputPrompt, mapPrompt, reducePrompt, label?, model?, reasoning?, maxAttempts?, ...templateValues })` coerces `inputPrompt` into `{ items: [...] }`, runs one map agent per item, then runs one reduce agent. String prompts can use `{{item}}`, `{{index}}`, `{{results}}`, and any extra template values.

`verifier({ criteria, criteriaPrompt, reducePrompt, label?, model?, reasoning?, ...templateValues })` runs one voter agent per criterion voter and then reduces the votes. Each criterion must include `name`, `description`, `guidelines`, `reasoning`, and optional `voters`.

Agents spawned from workflows can call `run_workflow` to invoke an existing workflow, `workflow_primitives` to look up workflow globals and examples, `debug_workflow` to run a small workflow draft in a temporary sandbox with fake child-agent responses, or `propose_workflow` to submit a new `.pi/workflows/<name>/workflow.js` draft. `debug_workflow` is for controlled checks only: keep snippets simple, pass fake `agentResponses`, and prefer minimal/low-thinking model labels. Generated workflows are review-gated. Pi shows a natural-language proposal before saving under `.pi/workflows/<name>/workflow.js` or running it, and reviewer-updated source is what gets saved.

## Commands

```text
/workflow <workflow-name> [--save-log] [input]
/workflow:<workflow-name> [--save-log] [input]
/workflow <natural-language request>
/workflow-review <workflow-name>
```

Examples:

```text
/workflow count-to-target target=10
/workflow:review files=src/index.ts,tests/index.test.ts
/workflow:review prompt="focus on auth edge cases" files=src/auth.ts,tests/auth.test.ts
/workflow review the auth flow and create a reusable workflow if needed
/workflow-review review
```

Named workflow commands (`/workflow <name>` and `/workflow:<name>`) run the saved workflow directly for JSON and `key=value`/`--key value` input. Freeform named-workflow input is sent into the current session as a normal visible, steerable conversation: pi-workflow displays the exact prompt it passes to the agent, including `metadata.inputInstructions`, the workflow function JSDoc/signature contract, and the user's input. The agent asks if required fields are missing and calls `run_workflow` only when the input is complete. Missing required args in direct JSON/key-value calls produce an actionable message instead of starting the workflow and crashing. Every child agent launched for a workflow stores logs under `~/.pi/agent/sessions/<project-key>/<parent-run-id>/<agent-key>/`, with `metadata.json`, in-flight `events.jsonl`, and the pi session JSONL. Token counts are never estimated; pi-workflow reports provider usage from events/session JSONL when available. Pass `--save-log` to also save the workflow-level debugging trajectory under `.pi/workflow-runs/<parent-run-id>/` with `metadata.json`, `input.json`, `workflow.js`, `events.jsonl`, `final-snapshot.json`, and the final `result.json` or `error.json`. While a workflow is running in the TUI, pi-workflow shows a compact `args ...` preview of the normalized run input, phase history, expanded active phase children, collapsed completed phases, and model, thinking, input tokens, assistant output tokens, tool calls, and NET totals.

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
