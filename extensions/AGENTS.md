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
- Keep generated workflow saves review-gated: the reviewer opens a TUI review overlay with a flowchart-style summary plus the parsed workflow outline (navigable phases/stages/prompts with per-stage notes and a general comment) and falls back to the in-terminal text approval when not in TUI mode or when the user presses `t`. Keep the review tree/rendering/change-request logic in `src/display/workflow-review.ts`; the extension only wires keys and the comment editor.
- Register commands/tools with clear descriptions and stable names.
- Prefer macOS-friendly advertised TUI shortcuts (reliable control sequences) over F-key or Option/Alt-only bindings; keep legacy fallbacks only when they do not conflict.
- Do not put testable orchestration logic here.
- Update `README.md`, `docs/`, and relevant `AGENTS.md` when command or UI behavior changes.

See `../agent_docs/INDEX.md` before changing patterns.
