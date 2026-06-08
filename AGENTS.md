# pi-looporch Agent Instructions

This repository is a pi package that adds loop orchestration primitives to pi.

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
- Put testable loop orchestration logic in `src/`.
- Loops are project data under `.pi/loops/<loop-name>/LOOP.md` with optional `loop.js`; `.pi/settings.json` may add external loop roots via `looporch.loopDirs`.
- Core runtime accepts normalized inputs; command handlers do parsing and coercion.
- Use deterministic fake agents in tests. Do not call real models from tests.
- Prefer simple functions over framework code, managers, or class hierarchies.
