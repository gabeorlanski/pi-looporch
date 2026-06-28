# agent_docs/ Agent Instructions

## Commands

```bash
npm run format:check
npm run check
```

## Purpose

`agent_docs/` stores concise agent-facing coding guidance learned while working in this repository.

## Rules

- Keep `INDEX.md` present and authoritative.
- Keep longer guidance in focused topic files and link them from `INDEX.md`.
- Keep rules topic-grouped like a PR-review-pattern index, not chronological notes.
- Add a new rule only when user guidance or code pushback is a generalizable coding pattern.
- Do not record one-off preferences, temporary task constraints, or stale implementation notes.
- Keep entries crisp; link to source files or docs when more context is needed.
- Mirror durable guidance changes into relevant `AGENTS.md` files.
