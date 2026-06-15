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

Workflow code runs in a restricted sandbox. It receives direct globals instead of a context object: `agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, `cwd`, `budget`, `readText`, and `readJson`. File helpers are constrained to the workflow directory.

Agents spawned from workflows can call `run_workflow` to invoke an existing workflow, or `propose_workflow` to submit a new `.pi/workflows/<name>/workflow.js` draft. Generated workflows are review-gated. Pi shows a natural-language proposal before saving under `.pi/workflows/<name>/workflow.js` or running it, and reviewer-updated source is what gets saved.

## Commands

```text
/workflow <workflow-name> [json-or-text-input]
/workflow:<workflow-name> [json-or-text-input]
/workflow <natural-language request>
/workflow-review <workflow-name>
```

Examples:

```text
/workflow count-to-target {"target":10}
/workflow:review {"files":["src/index.ts","tests/index.test.ts"]}
/workflow review the auth flow and create a reusable workflow if needed
/workflow-review review
```

While a workflow is running in the TUI, pi-workflow shows a compact panel with the active phase, grouped fan-out progress, child agent status, and token count. Press `Esc` to cancel.

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
