# src/session/ Agent Instructions

## Purpose

`src/session/` owns child-session persistence: event metadata, token usage parsing,
workflow session summary paths, logged child-session setup, and transcript reading.

## Files

- `events.ts`: compact event-log metadata.
- `usage.ts`: provider usage normalization and session-token parsing.
- `logs.ts`: workflow and child-session log paths plus run summaries.
- `agent-logs.ts`: Pi child-session persistence.
- `transcript.ts`: bounded JSONL transcript reading.

Keep session-log formats and paths compatible with `log-review.ts` and runtime
output consumers. See `../AGENTS.md` and `../../agent_docs/INDEX.md`.
