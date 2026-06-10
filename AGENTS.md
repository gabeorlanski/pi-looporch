# pi-workflow Agent Instructions

This repository is a pi package that adds workflow orchestration primitives to pi.

## Commands

Run these before every commit:

```bash
npm run check
```

Useful focused commands:

```bash
npm run lint       # ESLint, zero warnings
npm run typecheck  # TypeScript without emit
npm test           # deterministic node:test suite
npm run loadcheck  # verify pi can load the extension
npm run pack:dry   # inspect package contents
```

## Project rules

- Keep the extension small and dependency-light.
- Put pi command/UI wiring in `extensions/`.
- Put testable workflow orchestration logic in `src/`.
- Workflows are project data under `.pi/workflows/<workflow-name>/workflow.js`; `.pi/settings.json` may add external workflow roots via `workflow.workflowDirs`.
- Core runtime accepts normalized inputs; command handlers do parsing and coercion.
- Use deterministic fake agents in tests. Do not call real models from tests.
- Prefer simple functions over framework code, managers, or class hierarchies.
