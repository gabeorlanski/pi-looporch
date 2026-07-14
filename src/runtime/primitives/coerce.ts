import type { ActiveWorkflowRuntime, CoerceOptions, WorkflowPrimitive } from "../context.ts";
import { runAgent } from "./agent.ts";

export const coercePrimitive: WorkflowPrimitive<{ coerce: (options: CoerceOptions) => Promise<unknown> }> = {
  name: "coerce",
  docs: [
    {
      name: "coerce",
      signature: "coerce({ schema, prompt, label?, model?, reasoning?, maxAttempts?, extensions?, tools? })",
      summary:
        "Uses a child agent with strict JSON Schema validation and focused isolated repair attempts for compact extraction or normalization.",
    },
  ],
  globals: ({ runtime }) => ({ coerce: (options: CoerceOptions) => coerceWithAgent(runtime, options) }),
};

export async function coerceWithAgent(runtime: ActiveWorkflowRuntime, options: CoerceOptions): Promise<unknown> {
  if (typeof options.prompt !== "string" || !options.prompt.trim()) throw new Error("coerce prompt must be non-empty");
  return runAgent(runtime, options.prompt, {
    label: options.label ?? "coerce",
    model: options.model,
    reasoning: options.reasoning,
    schema: options.schema,
    maxAttempts: options.maxAttempts,
    extensions: options.extensions,
    tools: options.tools,
  });
}
