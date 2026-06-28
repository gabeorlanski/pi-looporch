# Documentation Style Guide

## Purpose

Use this guide for `README.md`, `docs/`, `agent_docs/`, `AGENTS.md`, workflow guidance, and extension-facing copy. Documentation should be concise, technical, current, and useful.

## Sources

- Developer docs style: <https://developers.google.com/style/highlights>, <https://developers.google.com/style/api-reference-comments>.
- Documentation structure: <https://diataxis.fr/>, <https://www.writethedocs.org/guide/>.
- Pi prose rules: <https://github.com/earendil-works/pi/blob/main/AGENTS.md>.

## Structure

- Start with the user or maintainer task the doc supports.
- Use short sections with task-oriented headings.
- Put commands and contracts in fenced code blocks.
- Keep examples complete enough to run or adapt.
- Link to source files, upstream docs, or durable specs when a rule depends on an external contract.
- Keep `agent_docs/INDEX.md` as the short entry point. Put longer guidance in topic files.

## Style

- Write direct technical prose.
- Prefer active voice and concrete nouns.
- Avoid cheerleading, filler, unexplained acronyms, and marketing copy.
- Explain tradeoffs when they affect implementation choices.
- Use exact names for commands, files, APIs, settings, env vars, and types.
- Use absolute dates for time-sensitive claims.

## Code And API Docs

- Document contracts, boundary behavior, side effects, errors, and cleanup.
- Do not comment one-expression helpers or obvious assignments.
- Use JSDoc for exported APIs, generated workflow `workflow()` functions, and non-obvious contracts; `npm run docs:check` enforces the current public API module scope.
- Keep prompt templates self-contained: mission, source paths, invariants, commands/search strategy, evidence requirements, pass/fail gates, and output contract.
- For generated workflows, document the default function with purpose, input fields/defaults, phases, child agents, file reads, and result shape.

## Synchronization Rules

- Update user docs when commands, tools, settings, storage layout, sandbox rules, workflow primitives, or visible behavior changes; staged behavior-surface changes must include a staged README/docs/agent_docs/AGENTS update.
- Update `agent_docs/` when a durable coding convention or project rule changes.
- Mirror durable guidance into relevant `AGENTS.md` files when agents need the rule before editing that area.
- Do not record one-off preferences, temporary workarounds, or stale implementation notes as rules.
- Keep docs close to the behavior: README for users, `docs/` for design, `agent_docs/` for coding guidance, `AGENTS.md` for local editing instructions.

## Examples

- Prefer examples that show the recommended path, not every possible path.
- Keep examples small, but include required imports, input shape, and expected output when relevant.
- Mark dangerous or environment-dependent commands clearly.
- Do not paste large generated outputs into docs. Summarize and link to the artifact shape or source.

## Anti-Patterns

- Docs that repeat code without adding contract or usage information.
- Chronological notes in durable guide files.
- Hidden behavior changes without README/docs updates.
- API comments that only restate the function name.
- Stale compatibility notes after old paths have been removed.
- Uncited claims about upstream Pi behavior or external standards.
