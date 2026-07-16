# Workflow Authoring

> Rules for authoring `.pi/workflows/<name>/workflow.js` runbooks: child-agent prompt packets, typed
> schemas, verifiers, `renderPrompt` templates, phases, dataflow, `log`/`trace`, and draft saving.

**When to check**: When generating or editing a workflow definition, its child-agent prompts, its
`prompts/` templates, its output schemas, or its draft directory.

## Rules

These rules do not restate sibling guides: structured-JSON-as-control-surface and
large-evidence-to-files live in `pi-agent-harness.md` (rules 9-10); general child-agent isolation and
path resolution live in `pi-agent-harness.md`; bounded completion previews and compact live widgets
live in `tui-style.md`.

<!-- rule:1 -->

- Lean into power-user runbook style — top-level constants, inline schemas, prompt-builder helpers, and explicit local assumptions — because workflows are executable runbooks meant to be inspected and tweaked by agents, so directness beats package-like indirection.
<!-- rule:2 -->
- Document the default workflow function with JSDoc covering purpose, input fields/defaults, phases, child-agent usage, file reads, and result shape — the JSDoc is the input contract named commands render for users — so an incomplete header produces unusable command prompts.
<!-- rule:3 -->
- Require metadata `phases: [{ title, detail? }]` as the planned runbook outline, and treat runtime `phase()` calls as actual progress — planning data and progress signal are different things — conflating them loses either the plan or the live status.
<!-- rule:4 -->
- When authoring from a `/workflow` request, infer purpose, inputs/defaults, phases, child-agent roles, file reads, and result shape from the request, docs, code, tests, and existing workflows, and ask only for unknowable or high-impact choices — most ambiguity is resolvable from context — asking about resolvable details wastes user turns.
<!-- rule:5 -->
- Write each child-agent prompt as a self-contained expert task packet: mission, source-of-truth paths, relevant prior results, invariants, concrete commands/search strategy, evidence requirements, pass/fail gates, and the exact artifacts to read or write — children share no parent memory — a thin prompt yields a child that cannot see the state the parent assumed.
<!-- rule:6 -->
- Use Markdown or plain text by default in child prompts. Add a few stable domain-specific XML tags only when complex mixed instructions, context, examples, documents, or dynamic inputs need unambiguous boundaries; do not tag every heading or sentence. Tags are delimiters, not a security boundary; use `schema` and `StructuredOutput` for machine-readable results. Pi-workflow owns `<workflow_instructions>`, `<workflow_task>`, `<workflow_context>`, and, for schema-enabled agents, `<structured_output_contract>` and `<structured_output_schema>`; do not reuse them in child prompt files because repeated envelopes blur scope for the agent. Keep inputs deliberately small, pass paths/IDs/counts or compact manifests instead of repeated bulk context, and omit inputs/globals a stage does not consume.
<!-- rule:7 -->
- Keep reusable child prompts in workflow-local `prompts/*.txt` with `{{name}}` placeholders, render them via `renderPrompt("relative/path.txt", values)` using string-literal paths relative to `prompts/` (never prefixed `prompts/` or `@workflow/prompts/`), reserve inline prompts for tiny glue, and split into separate files past ~5 distinct non-verifier prompts — string-literal paths keep references searchable and small files stay reviewable — dynamic paths and oversized templates become unmaintainable.
<!-- rule:8 -->
- Use `agent(prompt, { schema })` when a child must return structured fields. The schema is prepended to its prompt and becomes a terminal `StructuredOutput` tool; Pi validates the tool arguments and the child fails if it completes without calling the tool.
<!-- rule:9 -->
- Keep structured-output schemas token-efficient and semantic: describe every field inline, keep shapes shallow with short keys, enums/booleans, `additionalProperties: false`, stable lookup IDs, and staged expansion, and add bounds only for real downstream limits — schemas are paid for on every call and vague contracts produce unreliable tool calls.
<!-- rule:10 -->
- Keep dataflow explicit: `phase()` is a progress marker, not shared memory, so later agents receive earlier results only when the workflow renders those results into their prompts — agents cannot read state you did not pass them — assuming implicit sharing silently drops context.
<!-- rule:11 -->
- Read/write workflow files through the shared helpers, which accept absolute paths, bare relative paths (from project cwd), and `@workflow/...` paths (from the workflow dir), with atomic writes centralized — one pathing/atomic-write implementation — per-primitive path handling drifts and risks partial writes.
<!-- rule:12 -->
- Pass `agent(prompt, { cwd })` when a child should operate from a scratch or alternate directory, resolving relative `cwd` from the workflow project cwd — an explicit cwd makes the child's file base reconstructable — an implicit cwd hides where artifacts came from.
<!-- rule:13 -->
- Use `log(message)` for user-facing milestones (before slow launches, after key decisions, at handoffs) and `trace(label, value?)` for durable structured debug state that should appear in snapshots/session summaries — the two serve users vs. debuggers — collapsing them either spams the live view or loses replayable state.
<!-- rule:14 -->
- Add adversarial verifier/repair stages only when the artifact's risk justifies the extra agents, and have verifier prompts cite evidence and separate major correctness failures from recommendations — verification has real token cost — verifying everything wastes budget, and unstructured verdicts are not actionable.
<!-- rule:15 -->
- Propose a generated workflow as a complete draft directory (defaults to `<tmpdir>/pi-workflow-drafts/<name>/` via `defaultWorkflowDraftDirectory`; any absolute or project-relative `draftDir` outside `.pi/workflows` also works) whose `draftDir` points at the directory, not the `workflow.js` file, and let `propose_workflow` validate and save it in one call with no confirmation flag or two-step flow — proposal validation resolves inline/top-level `const` capability lists and settings defaults against Pi's real extension/tool metadata, aggregates source-located failures, and saves nothing on error — the draft directory is the reviewable unit and invalid authority must not replace a published workflow.
<!-- rule:16 -->
- Give every `agent`, `mapreduce`, and `verifier` call intentional `extensions?: string[]` and `tools?: string[]` authority, or deliberately inherit the merged workflow settings — absent settings mean all, `[]` means none, and per-call lists override — hidden authority makes workflows difficult to review. A schema-enabled child always receives `StructuredOutput`.
<!-- rule:17 -->
- Treat explicit tool lists as exact: naming an extension-owned tool loads its owner but not sibling tools; naming an extension while leaving tools unrestricted exposes built-ins plus all tools from that extension — extension loading and tool exposure are related but distinct controls — conflating them silently widens or removes authority.
