# extensions/ Agent Instructions

## Commands

```bash
npm run lint
npm run format:check
npm run loadcheck
npm run check
```

## Purpose

`extensions/` contains pi package wiring: slash commands, tools, passive workflow progress, notifications, and integration with pi APIs.

## Rules

- Keep this layer thin; delegate workflow behavior to `src/`.
- Put command-specific parsing and host message wiring in `extensions/commands/`; keep `extensions/workflow.ts` focused on registration, workflow steering, and session hooks.
- Parse and coerce command text here before calling core code.
- Keep generated workflow saving direct. `propose_workflow` validates a complete draft directory and saves it in one call.
- Register commands/tools with clear descriptions and stable names.
- Do not add workflow keybindings unless the user explicitly asks for an interactive control surface.
- Do not put testable orchestration logic here.
- Update `README.md`, `docs/`, and relevant `AGENTS.md` when command or UI behavior changes.

See `../agent_docs/INDEX.md` before changing patterns.
