# src/pi-agent/ Agent Instructions

## Purpose

`src/pi-agent/` adapts Pi child-agent sessions to workflow runtime contracts and
resolves extension and tool capabilities.

## Files

- `adapter.ts`: Pi `WorkflowAgent` adapter and progress tracking.
- `capabilities/`: catalog discovery and exact access resolution.

Keep provider and capability state child-session-local. Inject Pi dependencies at
the adapter boundary; do not hardcode them into workflow core logic. See
`../AGENTS.md` and `../../agent_docs/INDEX.md`.
