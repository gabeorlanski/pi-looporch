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
- Isolate child agents from ambient parent state by default, loading only a curated extension set — prevents accidental inheritance of hooks, tools, and mutable globals — stops surprising cross-contamination that makes child runs non-reproducible.
<!-- rule:5 -->
- Resolve child-agent resource paths from the project root, not from a scratch or alternate working directory — anchors resolution to a stable base — avoids path breakage when a child runs from a different cwd.
<!-- rule:6 -->
- Make any alternate working directory explicit in the child's prompt, logs, and session metadata — surfaces a hidden execution assumption — reviewers and debuggers can reconstruct where files were read and written.
<!-- rule:7 -->
- Declare tool access with explicit allowlists, and disable tools entirely for pure extraction or coercion work — least privilege by construction — narrows the attack and error surface and keeps agent behavior predictable.
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
- Keep the canonical conversation transcript separate from compact metadata event logs — two logs serve two audiences — the transcript stays complete for replay while metadata logs stay small for scanning and joining runs.
<!-- rule:15 -->
- Record enough metadata to join artifacts back to a run, such as cwd, parent id, agent id, model, start time, and settings — establishes provenance — makes it possible to trace any artifact to the run that produced it.
<!-- rule:16 -->
- Never estimate token counts from text length; use provider-reported usage or report unknown — character heuristics are wrong across tokenizers — bad counts corrupt cost accounting and budget enforcement.
<!-- rule:17 -->
- Bound parallelism across both direct concurrent agent calls and fan-out helpers — caps concurrency at every spawn path — prevents rate-limit storms, resource exhaustion, and runaway cost.
<!-- rule:18 -->
- Test harness code with deterministic fake agents and never call real providers or live sessions in tests — determinism over network flakiness — asserts isolation, allowlists, settings merge, abort, and cleanup reliably and fast.
