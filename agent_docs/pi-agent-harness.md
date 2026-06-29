# Pi Agent Harness Guide

## Purpose

Use this guide when integrating with upstream Pi, authoring extensions, creating child-agent SDK sessions, or changing this repository's workflow harness. Pi is extension-driven and powerful by default, so make boundaries, permissions, session lifecycle, and logs explicit.

## Sources

- Pi repo and packages: <https://github.com/earendil-works/pi>.
- SDK and examples: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md>, <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/README.md>.
- Extensions and packages: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md>, <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md>, <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts>.
- Sessions and security: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md>, <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md>.
- Upstream agent rules: <https://github.com/earendil-works/pi/blob/main/AGENTS.md>.

## Harness Boundaries

- Keep Pi SDK construction in adapter modules. Core workflow/runtime logic accepts injected agents, settings, loaders, and sessions.
- Treat `createAgentSession()` as an integration boundary. Pass explicit services when determinism or isolation matters.
- Use `createAgentSessionRuntime()` only when the active session can be replaced. Re-subscribe and re-bind extensions after replacement.
- Keep tool allowlists explicit: Pi distinguishes `tools`, `excludeTools`, `noTools`, and `customTools`.
- Keep user input parsing in commands, tools, TUI handlers, and config readers. Do not let model-facing runtime code guess input shape.

## Extension Design

- Register tools with `defineTool(...)` so TypeBox parameter inference survives arrays and standalone variables.
- Tool definitions need a clear `name`, `label`, LLM `description`, TypeBox `parameters`, and `execute` body that respects `AbortSignal`.
- Use `promptSnippet` and `promptGuidelines` only for behavior the model must know.
- Use `renderCall` and `renderResult` when a tool needs custom compact display. Keep result payloads and details separate from the visible component.
- In extension handlers, branch on `ctx.mode` and `ctx.hasUI`; custom TUI components are for TUI-capable contexts, not print/json assumptions.
- Use `ctx.ui.custom`, `ctx.ui.setWidget`, `ctx.ui.setFooter`, `ctx.ui.setHeader`, and overlays as UI APIs, not ad hoc stdout writes.
- Do not add custom workflow editors or keybindings unless the user explicitly asks for an interactive control surface.
- Start long-lived resources from `session_start`, commands, tools, or explicit events; not from the extension factory.
- Close long-lived resources from an idempotent `session_shutdown` handler.
- Keep extension state session-aware. Prefer session entries, tool details, or explicit persisted data over module globals.

## Package Manifests

- Advertise resources through the package `pi` manifest: `extensions`, `skills`, `prompts`, and `themes`.
- Include the `pi-package` keyword for package discoverability.
- Treat Pi core packages used by extensions as peers: `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox`.
- Keep local development dependencies separate from runtime peer expectations.

## Child-Agent Isolation

- Child agents should not inherit ambient parent-session extensions, hooks, or mutable state by accident.
- Prefer `DefaultResourceLoader({ noExtensions: true, additionalExtensionPaths })` for child sessions that need a curated extension set.
- Resolve project-relative child extension paths from the project root, not from a scratch or child-agent `cwd`.
- Use `SessionManager.inMemory(...)` for ephemeral work and `SessionManager.create(...)` when transcripts must persist.
- If a child agent runs from an alternate `cwd`, make that choice explicit in the prompt, logs, and session metadata.
- Disable tools with `noTools: "all"` or `tools: []` for pure extraction/coercion work.

## Permissions And Trust

- Do not describe Pi project trust as a sandbox. Pi runs with the permissions of the launching process unless the user adds isolation.
- If hard boundaries matter, document the actual boundary: whole-process Docker/OpenShell or tool routing through Gondolin.
- Extension tools execute wherever the Pi process runs unless they explicitly delegate to a sandbox.
- Be clear about credential placement when documenting containerized or tool-routed runs.

## Sessions, Events, And Logs

- Subscribe to session events for progress; unsubscribe in `finally`.
- Call `session.dispose()` when an SDK session is done.
- Treat streamed `message_update` events as UI/progress data.
- Treat the Pi session JSONL as the canonical conversation transcript.
- Keep secondary `events.jsonl` logs compact: lifecycle events, model/provider metadata, token usage, counts, tool names, and paths. Do not duplicate full messages or tool result payloads.
- Never estimate token counts from text length. Use provider usage or report unknown/zero.
- Record enough metadata to join artifacts back to a run: cwd, parent id, agent id/key, session files, model, start time, and settings.

## Workflow Harness Rules

- `run_workflow` validates input at the tool boundary, reads merged settings, streams compact progress, starts a background run, and returns temp output/result paths.
- Keep live workflow snapshots lightweight. Store counters and artifact paths there; write full child outputs and final results to the run outputs directory with an atomic `running`/`done`/`error` manifest.
- `propose_workflow` requires complete draft directories and saves directly after validation.
- Workflow results, including strings, stay in output files and session logs.
- Runtime `phase()` calls are progress markers, not shared memory.
- Bounded parallelism must apply across direct concurrent `agent(...)` calls and fan-out helpers.

## Testing

- Test harness code with deterministic fake agents.
- Do not call real providers, live Pi sessions, or actual user auth in tests.
- Assert child resource loaders disable ambient extensions by default.
- Assert tool allowlists, `noTools`, settings merge behavior, session-log sanitization, token usage parsing, abort behavior, and cleanup.
- Prefer behavior-level tests for visible messages, tool outputs, and error strings over source snapshots.

## Anti-Patterns

- Constructing models or sessions inside core runtime logic.
- Assuming extension state is safe to share between parent and child sessions.
- Describing trust prompts as sandboxing.
- Persisting full streamed deltas in secondary event logs.
- Estimating tokens from character counts.
- Writing directly to stdout from TUI extension code.
- Catching SDK errors without surfacing actionable context.
- Starting background work in the extension factory.
- Assuming every Pi mode has dialogs or terminal UI.
- Storing important session behavior only in module globals.
- Guessing SDK/TUI APIs instead of reading installed declarations.
