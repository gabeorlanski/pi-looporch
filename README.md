# pi-looporch

A small pi extension for running project-local agent loops instead of repeatedly prompting a coding agent by hand.

## Install in pi

From this checkout:

```bash
pi install /path/to/pi-looporch
```

For development:

```bash
npm install
npm run check
pi -e ./extensions/loop.ts
```

## Loop layout

Loops can live in the project using the extension:

```text
.pi/loops/<loop-name>/
  LOOP.md      # human-readable loop intent and instructions
  loop.js      # optional executable orchestration
  ...          # optional task files referenced by loop.js
```

You can also point a project at external loop directories with `.pi/settings.json`:

```json
{
  "looporch": {
    "loopDirs": ["../shared-loops", "/absolute/path/to/loop-library"]
  }
}
```

Each entry can be either a loop root containing `<loop-name>/LOOP.md` children or a direct loop directory containing `LOOP.md`. Relative paths resolve from the project root. Project-local `.pi/loops` is always searched first.

`loop.js` exports one function:

```js
export default async function loop(ctx) {
  ctx.phase("fanout");
  const result = await ctx.agent("Review the auth flow", {
    label: "auth review",
    reasoning: "high",
    model: "anthropic/claude-sonnet-4-5"
  });
  return { result };
}
```

The context provides `input`, `loopDir`, `loopName`, `loopMarkdown`, `agent()`, `phase()`, `log()`, `readLoopFile()`, and `resolveLoopPath()`.

If `loop.js` is absent, pi-looporch asks an agent to generate the loop implementation from `LOOP.md` and the provided input, then runs that generated loop for the current invocation.

## Commands

```text
/loop <loop-name> [json-or-text-input]
/loop:<loop-name> [json-or-text-input]
```

Examples:

```text
/loop count-to-target {"target":10}
/loop:review {"files":["src/index.ts","tests/index.test.ts"]}
```

While a loop is running in the TUI, pi-looporch shows a compact panel with the active phase, rough token estimate, agent progress, and the current plan phases. Press `Esc` to cancel.

## Development

```bash
npm run lint
npm run typecheck
npm test
npm run loadcheck
npm run check
```

Tests use deterministic fake agents only; they do not call real models.
