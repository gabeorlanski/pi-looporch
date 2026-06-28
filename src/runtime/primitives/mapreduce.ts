import type { ActiveWorkflowRuntime, MapReduceOptions, WorkflowPrimitive } from "../context.ts";
import { renderPromptTemplate } from "../prompts.ts";
import { coerceWithAgent } from "./coerce.ts";
import { runAgent } from "./agent.ts";
import { runParallel } from "./parallel.ts";

export const mapReducePrimitive: WorkflowPrimitive<{ mapreduce: (options: MapReduceOptions) => Promise<unknown> }> = {
  name: "mapreduce",
  globals: ({ runtime }) => ({ mapreduce: (options: MapReduceOptions) => mapReduceWithAgents(runtime, options) }),
};

async function mapReduceWithAgents(runtime: ActiveWorkflowRuntime, options: MapReduceOptions): Promise<unknown> {
  const { inputPrompt, mapPrompt, reducePrompt, label: labelOption, model, reasoning, maxAttempts, ...context } = options;
  const label = typeof labelOption === "string" && labelOption.trim() ? labelOption : "mapreduce";
  const input = await coerceWithAgent(runtime, {
    schema: mapReduceInputSchema,
    prompt: renderPromptTemplate(inputPrompt, context),
    label: `${label} input`,
    model,
    reasoning,
    maxAttempts,
  });
  const items = (input as { items: unknown[] }).items;
  const mapped = await runParallel(
    runtime,
    items,
    (item, index) =>
      runAgent(runtime, renderPromptTemplate(mapPrompt, { ...context, item, index, items }), {
        label: `${label} map ${String(index + 1)}`,
        model,
        reasoning,
      }),
    `${label} map`,
  );
  return runAgent(runtime, renderPromptTemplate(reducePrompt, { ...context, items, results: mapped }), {
    label: `${label} reduce`,
    model,
    reasoning,
  });
}

const mapReduceInputSchema = {
  type: "object",
  properties: { items: { type: "array", items: {} } },
  required: ["items"],
  additionalProperties: true,
};
