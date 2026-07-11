import type { ActiveWorkflowRuntime, CoerceOptions, WorkflowPrimitive } from "../context.ts";
import { jsonSchemaPrompt, normalizeAttemptCount, parseAndValidateJsonResponse } from "../schema.ts";
import { runAgent } from "./agent.ts";

export const coercePrimitive: WorkflowPrimitive<{ coerce: (options: CoerceOptions) => Promise<unknown> }> = {
  name: "coerce",
  docs: [
    {
      name: "coerce",
      signature: "coerce({ schema, prompt, label?, model?, reasoning?, maxAttempts? })",
      summary: "Uses a no-tools child agent with JSON Schema validation retries for compact extraction or normalization.",
    },
  ],
  globals: ({ runtime }) => ({ coerce: (options: CoerceOptions) => coerceWithAgent(runtime, options) }),
};

export async function coerceWithAgent(runtime: ActiveWorkflowRuntime, options: CoerceOptions): Promise<unknown> {
  if (typeof options.prompt !== "string" || !options.prompt.trim()) throw new Error("coerce prompt must be non-empty");
  const maxAttempts = normalizeAttemptCount(options.maxAttempts, "coerce");
  let validationFailure: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await runAgent(
      runtime,
      jsonSchemaPrompt(
        "Return only JSON that validates against this JSON Schema. Do not include markdown fences, commentary, or extra text.",
        options.prompt,
        options.schema,
        validationFailure,
      ),
      {
        label: options.label ?? "coerce",
        model: options.model,
        reasoning: options.reasoning,
        tools: false,
      },
    );
    const validation = parseAndValidateJsonResponse(response, options.schema);
    if (validation.ok) return validation.value;
    validationFailure = validation.error;
  }
  throw new Error(`coerce failed schema validation after ${String(maxAttempts)} attempts: ${validationFailure ?? "unknown error"}`);
}
