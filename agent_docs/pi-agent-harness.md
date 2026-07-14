# Pi Agent Harness & Orchestration

> Rules for building coding-agent extensions and orchestrating child agents with clear boundaries, isolation, and observability.

**When to check**: When integrating an agent SDK, authoring extensions or tools, spawning child agents, or designing workflow orchestration.

## Rules

<!-- rule:1 -->

- Inject agents, sessions, settings, and loaders into core logic instead of constructing them there — keeps business logic decoupled from the SDK — lets you swap providers, run deterministically, and test without live services.
<!-- rule:2 -->
- Treat SDK/session construction as an integration boundary confined to adapter modules — isolates vendor coupling to one seam — a provider change or API break touches one file instead of rippling through core code.
<!-- rule:3 -->
- Parse and coerce all model-facing and user input at the edges — boundaries own normalization — core logic can then assume strict, validated shapes and stay free of defensive guessing.
<!-- rule:4 -->
- Resolve child-agent extension and tool authority from per-call lists over merged project/global defaults — omission inherits `workflow.childAgentExtensions`/`workflow.childAgentTools`, absent settings mean all, and `[]` means none — makes authority explicit without confusing an omitted default with an empty selection.
<!-- rule:5 -->
- Resolve child-agent resource paths from the project root, not from a scratch or alternate working directory — anchors resolution to a stable base — avoids path breakage when a child runs from a different cwd.
<!-- rule:6 -->
- Make any alternate working directory explicit in the child's prompt, logs, and session metadata — surfaces a hidden execution assumption — reviewers and debuggers can reconstruct where files were read and written.
<!-- rule:7 -->
- Treat a per-call tool list as an exact allowlist, loading an extension owner when one of its tools is named but exposing no sibling tools; when extensions are explicit and tools are unrestricted, expose built-ins plus all tools from those extensions — separates extension hooks/resources from exact tool exposure — keeps child behavior predictable.
<!-- rule:8 -->
- Write self-contained child-agent prompts that carry all context they need — children do not share parent memory — avoids silent failures when a child cannot see state the parent assumed was available.
<!-- rule:9 -->
- Use structured JSON as a control surface carrying status, ids, and paths — not as a payload channel for large content — keeps machine-readable output small and parseable while heavy data stays out of band.
<!-- rule:10 -->
- Write transcripts, tool outputs, and large evidence to files, and reference them by path — avoids bloating chat and logs — keeps the control plane lean and lets consumers fetch detail on demand.
<!-- rule:11 -->
- Subscribe to session events for progress and dispose sessions and subscriptions in a finally block — explicit lifecycle prevents leaks — dangling sessions and listeners accumulate resources and corrupt later runs.
<!-- rule:12 -->
- Start long-lived resources from explicit lifecycle events, never from a construction or factory path — separates wiring from activation — prevents background work from firing before the environment is ready.
<!-- rule:13 -->
- Close long-lived resources from an idempotent shutdown handler — safe to call more than once — guarantees cleanup even on repeated or partial teardown without double-free errors.
<!-- rule:14 -->
- Do not let timers, promises, or callbacks read a captured Pi extension context after session replacement or reload; capture stable values such as cwd/session id at startup and tear down session-scoped state from `session_shutdown` — Pi invalidates old contexts — delayed work must not touch stale UI or session-manager handles.
<!-- rule:15 -->
- Keep the canonical conversation transcript separate from compact metadata event logs — two logs serve two audiences — the transcript stays complete for replay while metadata logs stay small for scanning and joining runs.
<!-- rule:16 -->
- Record enough metadata to join artifacts back to a run, such as cwd, parent id, agent id, model, start time, and settings — establishes provenance — makes it possible to trace any artifact to the run that produced it.
<!-- rule:17 -->
- Never estimate token counts from text length; use provider-reported usage or report unknown — character heuristics are wrong across tokenizers — bad counts corrupt cost accounting and budget enforcement.
<!-- rule:18 -->
- Bound parallelism across both direct concurrent agent calls and fan-out helpers — caps concurrency at every spawn path — prevents rate-limit storms, resource exhaustion, and runaway cost.
<!-- rule:19 -->
- Test harness code with deterministic fake agents and never call real providers or models in tests; a local SDK session is allowed only for an extension-runtime identity probe that performs no model turn — determinism over network flakiness — asserts isolation, allowlists, settings merge, abort, and cleanup reliably and fast.
<!-- rule:20 -->
- Keep running-workflow inspector reattachment scoped by parent Pi session id, but keep `workflow_status`, `/workflow-status`, and the passive monitor widget project-scoped by default — separates ownership from observation — one session cannot adopt another session's run while users and agents can still monitor project-wide work.
<!-- rule:21 -->
- Surface workflow completion results through visible automated user-message handoffs with bounded result/report previews plus full output paths; users should not need a second prompt to see or ask for the result, and the handoff must trigger the current agent while making clear it was generated by workflow automation.
<!-- rule:22 -->
- Before publishing generated workflow code, statically resolve inline and top-level `const` capability arrays plus inherited settings, validate them against Pi's real loaded extension/tool metadata, aggregate source-located diagnostics, and do not save on any error — proposal-time validation is the authority boundary — invalid or ambiguous capability names must not become executable workflow state.
<!-- rule:23 -->
- Build child capability catalogs from the already-bound parent session when available; initialize only explicitly selected extension paths that are absent from the bound metadata so their tool names can still be validated. Then create every child with a fresh `DefaultResourceLoader({ noExtensions: true, additionalExtensionPaths })`; never reuse loaded extension objects or clone their runtime because extension API actions close over the original runtime. Pi's public `getAllTools()` reports the effective tool registry, so a parent-derived catalog cannot reconstruct registrations that Pi has already shadowed under the same name; reject every ambiguity visible in the catalog and rely on the fresh child load for final extension-load errors.
<!-- rule:24 -->
- Propagate a terminal provider error from a child session before interpreting its assistant text — avoids misreporting failed model requests as empty or malformed structured output.
