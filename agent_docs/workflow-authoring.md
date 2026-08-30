# Workflow Authoring

> Rules for generating or editing `.pi/workflows/<name>/`, child prompts, authoring guidance, cache layout, and structured schemas.

**When to check**: Before writing a workflow definition, child-agent prompt, `workflow_design_guidance` topic, or output schema.

## Design the runbook

- Work backward from the user-visible outcome. Define the scope boundary, inputs/defaults, ordered stages, explicit dataflow, final result, artifacts, and blockers before writing code.
- Give every stage authoritative reads, prior inputs and their use, required work, exact output, and a checkable completion criterion. A stage is complete only when every required action and deliverable has evidence.
- Write direct, inspectable `workflow.js` orchestration. Top-level constants and inline schemas are appropriate when they keep the runbook legible. Trust workflow input contracts, runtime primitives, and validated boundaries; add custom error behavior only when an authoritative contract requires that observable behavior.
- Export static `metadata` with `name`, `description`, `inputInstructions`, and planned `phases`. Document the default workflow function with JSDoc covering purpose, input fields/defaults, phases, child agents, file reads, artifacts, and result shape.

## Shape child context

- Build each child prompt as an information hierarchy. Keep the active task steps in the prompt, co-locate the rules needed by those steps, and disclose branch-only reference through sharp path pointers that name when to read it and what authority it has.
- A self-contained task contains everything its branch needs, not everything the parent knows. Include the goal/boundary, authoritative reads, ordered work, consumed inputs, exact deliverable, completion evidence, and blockers only when they apply to that task.
- Prefer positive target behavior. Use a prohibition only for a hard guardrail, paired with the desired action.
- Use one workflow-owned `prompts/*.txt` file per distinct child task and launch it through `agent({ template, values }, options)`. Every placeholder needs one value and every value must be referenced. Use inline prompts only for tiny one-off glue and `renderPrompt` only for exceptional composition.
- Pass paths, stable IDs, counts, compact manifests, and artifact references. Let children read project source and other cheap environment facts from their source of truth rather than pasting copies into context.
- Pi-workflow owns `<workflow_instructions>`, `<workflow_task>`, `<workflow_context>`, and `<structured_output_contract>`. Child prompt files use Markdown or plain text and leave those delimiters to the runtime.

## Keep the prefix cacheable

- Put stable, branch-relevant instructions that are expensive to rediscover before per-launch data. Matching launches should share that exact static prefix and place paths, IDs, counts, and manifests in a typed dynamic suffix.
- Treat scripts, config files, directory layout, and `--help` as environment sources of truth. Cache their contents only when lookup is genuinely expensive or the task requires a fixed snapshot.
- Split prompts by task branch instead of packing variants into one template. A branch split protects attention and usually produces a longer reusable prefix than conditional prose.

## Keep schemas minimal

- Treat structured JSON as a transport contract. Put task semantics, evidence requirements, and completion criteria in the prompt; put only downstream-consumed fields in the schema.
- Prefer shallow required objects with domain names, enums/booleans, stable IDs, counts, and artifact paths. Set `additionalProperties: false`. Add descriptions or bounds only when names/types and the task do not already establish the needed constraint.
- Keep reports, reasoning, evidence collections, diffs, transcripts, and large lists in files. Return their paths or a bounded manifest, then expand only selected IDs in a later stage.
- `agent(..., { schema })` exposes the authored schema unchanged as `StructuredOutput` tool parameters and does not repeat the JSON in the task prompt. `message`, `name`, `steps`, and `usage` are reserved runtime fields; schema-enabled results add runtime `message: null`, `name`, `steps`, and `usage` outside the authored schema.
- `LLM(..., { schema })` includes the schema in its system instruction because it has no tool contract. Use `LLM` for one generation without tools or a child session; use `agent` for tool use or iterative work.

## Pass artifacts and authority

- Phases are progress markers, not memory. Pass every required prior value or artifact path explicitly to the next stage.
- State an artifact's path, format, ownership, and downstream use in both producer and consumer tasks. Use `writeText`/`writeJson` for generated artifacts and `@workflow/...` for workflow-owned resources.
- Set `cwd` when a child uses an alternate working directory and state that base in its task. Choose `extensions` and exact `tools` intentionally; omission inherits workflow settings and `[]` grants none.
- Bound fan-out before launch and preserve worker results in a reducer manifest. Add one evidence-based verifier and one repair/re-review pass only when artifact risk justifies the cost.
- Use `log` for user-visible milestones and `trace` for compact structured debug state.

## Save the complete draft

- Stage `workflow.js` and every referenced prompt or resource under the default outside-project draft root. Call `propose_workflow` with the workflow name and omit `draftDir` only for that default location.
- Proposal validation must resolve child capabilities, report source-located failures, and leave the published workflow unchanged on error.
