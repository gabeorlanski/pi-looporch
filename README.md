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
  ...          # optional prompts, schemas, fixtures, and examples
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

`workflow.js` exports required metadata and a default function:

```js
/**
 * Purpose: review a set of files in parallel and synthesize findings.
 * Args: expects { files: string[] } and an optional user focus prompt.
 * Phase: fanout reviews each file, synthesis combines the findings.
 * Agent: launches one child agent per file, then one synthesis agent.
 * Result: returns the synthesis agent response.
 */
export const metadata = {
  name: "review",
  description: "Review a set of files in parallel and synthesize findings",
};

export default async function workflow() {
  phase("fanout");
  const reviews = await parallel(
    args.files,
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
  return agent("Synthesize these reviews:\n" + reviews.join("\n\n"), {
    label: "synthesis",
    reasoning: "medium",
  });
}
```

Workflow code runs in a restricted sandbox. It receives direct globals instead of a context object: `agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, `cwd`, `budget`, `readText`, and `readJson`. File helpers are constrained to the workflow directory. Agent-generated workflows must start with a JSDoc block that documents purpose, expected `args`, phases, child agent usage, and result shape before they can be saved.

Agents spawned from workflows can call `run_workflow` to invoke an existing workflow, or `propose_workflow` to submit a new `.pi/workflows/<name>/workflow.js` draft. Generated workflows are review-gated. Pi shows a natural-language proposal before saving under `.pi/workflows/<name>/workflow.js` or running it, and reviewer-updated source is what gets saved.

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

Named workflow commands (`/workflow <name>` and `/workflow:<name>`) run the saved workflow directly instead of asking the session agent to choose a tool. Manual calls do not require JSON: JSON and `key=value`/`--key value` are accepted directly, and freeform text is resolved by an agent against the workflow metadata/source into the `args` shape the workflow expects. Pass `--save-log` to save a debugging trajectory under `.pi/workflow-runs/<run-id>/` with `metadata.json`, `input.json`, `workflow.js`, `events.jsonl`, `final-snapshot.json`, and the final `result.json` or `error.json`. While a workflow is running in the TUI, pi-workflow shows phase history, expands active phase children, collapses completed phases, and summarizes model, thinking, input/output tokens, tool calls, and NET totals.

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
