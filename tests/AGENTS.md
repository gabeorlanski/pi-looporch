# tests/ Agent Instructions

Run `npm run check` from the repository root before handoff.

## Purpose

`tests/` provides deterministic `node:test` coverage for workflow discovery, runtime, requests, display rendering, prompt templates, and tools.

## Rules

- Use fake `WorkflowAgent` implementations only; never call real models or pi sessions.
- Test externally visible behavior and error messages.
- Keep fixtures local, minimal, and explicit.
- Add regression tests for bug fixes and user pushback that changes behavior.
- Prefer focused tests over broad snapshots.

See `../agent_docs/INDEX.md` before changing patterns.
