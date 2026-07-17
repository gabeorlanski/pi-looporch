# LLM Workflow Primitive

## Problem Statement

Workflow authors currently use `agent` for all model-assisted work, even when they only need one completed LLM generation. Child agents create unnecessary session, tool, capability-resolution, progress, and orchestration behavior for simple prompt-to-response tasks. Authors need a direct workflow primitive that can send a system prompt and constructed chat history to the LLM, receive either raw text or validated structured data, and continue composing workflow logic.

## Solution

Add an `LLM` workflow primitive for one direct, generation-only model request. It uses Pi's active model, provider, and authentication configuration. Authors provide a primary prompt plus optional system instructions and ordered prior messages; the primitive appends the primary prompt as the final user message and passes the complete history to Pi's model API.

Every call resolves to a consistent response envelope. Raw calls expose completed assistant text. Schema-enabled calls also expose validated structured output and reject malformed or nonconforming responses. `LLM` remains distinct from `agent`: it has no tools, extensions, agent session, child-agent launch record, repair loop, or streaming interface.

## User Stories

1. As a workflow author, I want to call `LLM` with one prompt, so that I can use a model completion without launching a child agent.
2. As a workflow author, I want to provide system instructions, so that each direct call follows task-specific behavior.
3. As a workflow author, I want to provide ordered prior messages, so that I can construct multi-turn context explicitly.
4. As a workflow author, I want the primary prompt appended as the final user message, so that the current request is unambiguous.
5. As a workflow author, I want Pi's model API to format the message history, so that direct calls use the active provider's native chat format.
6. As a workflow author, I want raw calls to return assistant text in a stable envelope, so that I can use free-form completions in subsequent workflow logic.
7. As a workflow author, I want schema-enabled calls to return validated structured output in that envelope, so that downstream logic can consume reliable data.
8. As a workflow author, I want malformed JSON and schema-invalid responses to reject, so that invalid structured data cannot silently continue through a workflow.
9. As a workflow author, I want response usage, model/provider identity, and termination metadata when available, so that I can inspect and account for a call.
10. As a Pi user, I want `LLM` to inherit my active model and authentication configuration, so that workflows do not contain provider credentials or duplicate session configuration.
11. As a workflow author, I want cancellation to reject the call promptly, so that cancelled workflows do not continue generating.
12. As a workflow author, I want provider failures to surface as failures, so that workflow error handling receives actionable errors.
13. As a workflow author, I want to compose `LLM` with existing phases, prompts, files, tracing, and parallel workflow logic, so that simple model calls fit naturally into workflow definitions.
14. As an operator, I want direct LLM calls not to appear as child agents or consume child-agent concurrency, so that workflow run state accurately reflects orchestration work.

## Implementation Decisions

- Register `LLM` as a workflow runtime global and include it in generated workflow primitive documentation.
- `LLM` is a direct model-call primitive, not an alias or wrapper around the child-agent primitive.
- The public request is prompt-first. It accepts a required primary prompt plus an optional system prompt, ordered additional/prior messages, and object schema. The primitive preserves supplied message order and appends the primary prompt as the final user message.
- The complete user/assistant message list is passed to Pi's model API for provider-specific formatting.
- The runtime obtains model, provider, and authentication solely from Pi's active configuration. Version one provides no workflow-level model, provider, or credential override.
- The runtime introduces an injected direct model-call adapter at the workflow execution boundary. This is the seam between strict workflow request normalization and Pi library integration, and allows deterministic tests without real models.
- Each invocation performs exactly one completed generation request. It does not create an agent session, perform capability resolution, use extensions or tools, consume a child-agent queue slot, or create an agent snapshot.
- The primitive always returns a response envelope with stable semantic fields for assistant text, structured output, usage, selected model/provider, and termination metadata. Metadata remains represented consistently when the underlying provider does not supply it.
- Without a schema, the envelope contains the completed assistant text and no structured output value.
- With a schema, the primitive accepts the project's existing JSON-Schema-compatible object convention. It validates the decoded result before resolving and places the validated value in the envelope.
- A schema-enabled call rejects for malformed structured output or a validation mismatch. It performs no automatic repair or follow-up request.
- Provider failures and aborts reject normally and preserve the workflow's existing cancellation semantics.
- Structured output for `LLM` is independent from the child-agent terminal structured-output tool and must not depend on tool execution.

## Testing Decisions

- Test externally observable workflow behavior rather than implementation details of the Pi library integration.
- Use the highest existing seam: execute workflow definitions with an injected deterministic direct model-call adapter, following existing workflow-runtime and injected-adapter test patterns.
- Verify primitive registration and generated documentation expose `LLM` to workflow definitions.
- Verify request construction: system prompt inclusion, preservation of supplied message order, final placement of the primary prompt as a user message, and native message forwarding.
- Verify active host configuration is passed to the adapter and that workflow calls cannot override model selection or credentials in version one.
- Verify raw calls return the expected stable envelope and structured calls return validated output plus completed text and available metadata.
- Verify malformed JSON and schema mismatches reject, with no second call or repair attempt.
- Verify provider failures and workflow cancellation reject through the workflow execution boundary.
- Verify a direct call launches no tools or child agents, creates no agent snapshot/session, and does not consume child-agent concurrency.

## Out of Scope

- Tool use, extension loading, agent loops, child-agent capability selection, and agent-session persistence.
- Token streaming or partial-response callbacks.
- Automatic retries, structured-output repair prompts, or multi-request recovery.
- Workflow-provided provider credentials, API keys, model selection, or provider selection.
- Changes to the existing `agent` primitive or its terminal structured-output behavior.

## Further Notes

`LLM` is intended for concise, deterministic workflow composition where a complete model response is the only required model interaction. Workflows that need autonomous tool use, iterative reasoning, or persistent agent behavior should continue using `agent`.
