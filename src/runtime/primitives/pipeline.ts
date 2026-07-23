/** Provides pipeline behavior. */
import { executionScope, nextExecutionId, type ActiveWorkflowRuntime, type PipelineStage, type WorkflowPrimitive } from "../context.ts";
import { throwIfWorkflowAborted } from "../abort.ts";

export const pipelinePrimitive: WorkflowPrimitive<{ pipeline: <T>(items: readonly T[], stages: PipelineStage<T>[]) => Promise<T[]> }> = {
  name: "pipeline",
  docs: [
    {
      name: "pipeline",
      signature: "pipeline(items, stages)",
      summary: "Runs each item through the same ordered async stages and returns transformed items.",
    },
  ],
  globals: ({ runtime }) => ({
    pipeline: <T>(items: readonly T[], stages: PipelineStage<T>[]) => {
      const executionId = nextExecutionId(runtime, "pipeline");
      return Promise.all(
        items.map((item, index) =>
          executionScope.run(`${executionId}/item-${String(index).padStart(4, "0")}`, () => runPipelineItem(runtime, item, index, stages)),
        ),
      );
    },
  }),
};

async function runPipelineItem<T>(runtime: ActiveWorkflowRuntime, item: T, index: number, stages: PipelineStage<T>[]): Promise<T> {
  let current = item;
  for (const stage of stages) {
    throwIfWorkflowAborted(runtime.options.signal);
    if (typeof stage !== "function") throw new TypeError("pipeline stages must be functions");
    current = await stage(current, index);
  }
  throwIfWorkflowAborted(runtime.options.signal);
  return current;
}
