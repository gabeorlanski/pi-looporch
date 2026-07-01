import type { ActiveWorkflowRuntime, PipelineStage, WorkflowPrimitive } from "../context.ts";
import { throwIfWorkflowAborted } from "../abort.ts";

export const pipelinePrimitive: WorkflowPrimitive<{ pipeline: <T>(items: readonly T[], stages: PipelineStage<T>[]) => Promise<T[]> }> = {
  name: "pipeline",
  globals: ({ runtime }) => ({
    pipeline: <T>(items: readonly T[], stages: PipelineStage<T>[]) =>
      Promise.all(items.map((item, index) => runPipelineItem(runtime, item, index, stages))),
  }),
};

async function runPipelineItem<T>(runtime: ActiveWorkflowRuntime, item: T, index: number, stages: PipelineStage<T>[]): Promise<T> {
  let current = item;
  for (const stage of stages) {
    throwIfWorkflowAborted(runtime.options.signal);
    current = typeof stage === "function" ? await stage(current, index) : await stage.run(current, index);
  }
  throwIfWorkflowAborted(runtime.options.signal);
  return current;
}
