# src/ Agent Instructions

## Purpose

`src/` contains testable workflow orchestration. Pi command and TUI registration stay in `extensions/`.

## Context pointers

- **Workflow authoring:** before editing guidance, child task wrappers, prompt templates, or schemas, read `../agent_docs/workflow-authoring.md`.
- **Agent integration:** before editing child sessions, capabilities, or lifecycle behavior, read `../agent_docs/pi-agent-harness.md`.
- **Repository map:** use `../agent_docs/INDEX.md` to locate other branch-specific guidance.

## Rules

- Run `npm run check` from the repository root before handoff.
- Accept normalized inputs; keep parsing and coercion at command, UI, tool, and config boundaries.
- Start each maintained TypeScript module with a concise purpose JSDoc and each exported callable with a contract JSDoc.
- Register runtime primitives through the shared `WorkflowPrimitive` protocol in `runtime/context.ts` and `runtime/globals.ts`.
- Inject `WorkflowAgent` and `WorkflowLLM`; never hardcode models or providers.
- Put display rendering in `display/`, raw prompt text in `prompts/`, and interpolation/domain shaping in TypeScript.
- Keep `workflow_design_guidance` content under `prompts/workflow-design/` and routing/rendering in `authoring-guide.ts`.
- Preserve sandbox boundaries: workflows have no imports or ambient Node globals; prompt templates resolve inside workflow `prompts/`; file helpers own absolute, project-relative, and `@workflow/...` path handling.
- Resolve child extension/tool authority from per-call selections over inherited settings. Keep exact tool lists exact and capability state child-session-local.
- Keep lifecycle cancellation and shutdown in the workflow layer. Persist large results in artifacts/session logs and surface final results through visible completion handoffs.
- Report provider usage only; never estimate tokens or cost.
- Add deterministic tests and synchronize docs for exported behavior changes.

## Map

- `runtime/`: workflow execution and primitives.
- `workflow/`: discovery-adjacent path, metadata, draft, status, output, and settings helpers.
- `pi-agent/`: Pi child-session and capability adapters.
- `display/`: TUI and visible messages.
- `session/`: child logs, events, and usage.
- `prompt-templates.ts`: typed prompt rendering.
- `authoring-guide.ts`: on-demand authoring topics.
- `structured-output.ts`: terminal schema tool.
