import type { PipelineStage, WorkflowPrimitive } from "../context.ts";

export const pipelinePrimitive: WorkflowPrimitive<{ pipeline: <T>(items: readonly T[], stages: PipelineStage<T>[]) => Promise<T[]> }> = {
  name: "pipeline",
  globals: () => ({
    pipeline: <T>(items: readonly T[], stages: PipelineStage<T>[]) =>
      Promise.all(items.map((item, index) => runPipelineItem(item, index, stages))),
  }),
};

async function runPipelineItem<T>(item: T, index: number, stages: PipelineStage<T>[]): Promise<T> {
  let current = item;
  for (const stage of stages) current = typeof stage === "function" ? await stage(current, index) : await stage.run(current, index);
  return current;
}
