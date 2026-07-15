import type { ActiveWorkflowRuntime, MapReduceOptions, WorkflowPrimitive } from "../context.ts";
import { renderPromptTemplate } from "../prompts.ts";
import { runAgent } from "./agent.ts";
import { runParallel } from "./parallel.ts";

export const mapReducePrimitive: WorkflowPrimitive<{ mapreduce: (options: MapReduceOptions) => Promise<unknown> }> = {
  name: "mapreduce",
  docs: [
    {
      name: "mapreduce",
      signature: "mapreduce({ inputPrompt, mapPrompt, reducePrompt, extensions?, tools?, ...context })",
      summary:
        "Selects items through terminal structured output, maps them through bounded child-agent fan-out, then reduces mapped outputs with one child agent.",
    },
  ],
  globals: ({ runtime }) => ({ mapreduce: (options: MapReduceOptions) => mapReduceWithAgents(runtime, options) }),
};

async function mapReduceWithAgents(runtime: ActiveWorkflowRuntime, options: MapReduceOptions): Promise<unknown> {
  const { inputPrompt, mapPrompt, reducePrompt, label: labelOption, model, reasoning, extensions, tools, ...context } = options;
  const label = typeof labelOption === "string" && labelOption.trim() ? labelOption : "mapreduce";
  const input = await runAgent(runtime, renderPromptTemplate(inputPrompt, context), {
    schema: mapReduceInputSchema,
    label: `${label} input`,
    model,
    reasoning,
    extensions,
    tools,
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
        extensions,
        tools,
      }),
    `${label} map`,
  );
  return runAgent(runtime, renderPromptTemplate(reducePrompt, { ...context, items, results: mapped }), {
    label: `${label} reduce`,
    model,
    reasoning,
    extensions,
    tools,
  });
}

const mapReduceInputSchema = {
  type: "object",
  description: "Select the bounded set of work items that should receive one map-agent launch each.",
  properties: {
    items: {
      type: "array",
      description: "The ordered work items to fan out to map agents. Keep the selection bounded and relevant to the input prompt.",
      items: {},
    },
  },
  required: ["items"],
  additionalProperties: true,
};
