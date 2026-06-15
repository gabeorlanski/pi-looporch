# extensions/ Agent Instructions

## Commands

```bash
npm run lint
npm run format:check
npm run loadcheck
npm run check
```

## Purpose

`extensions/` contains pi package wiring: slash commands, tools, TUI review, notifications, and integration with pi APIs.

## Rules

- Keep this layer thin; delegate workflow behavior to `src/`.
- Parse and coerce command text here before calling core code.
- Keep generated workflow saves review-gated through the TUI reviewer.
- Register commands/tools with clear descriptions and stable names.
- Do not put testable orchestration logic here.
- Update `README.md`, `docs/`, and relevant `AGENTS.md` when command or UI behavior changes.

See `../agent_docs/INDEX.md` before changing patterns.
