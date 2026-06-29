import type { WorkflowFanOutSnapshot } from ".././types.ts";
import { fanOutScope, type ActiveWorkflowRuntime, type WorkflowPrimitive } from "../context.ts";
import { appendRunMessage } from "../messages.ts";

export const parallelPrimitive: WorkflowPrimitive<{
  parallel: <T, R>(
    items: readonly T[],
    worker: (item: T, index: number) => Promise<R> | R,
    fanOutOptions?: { label?: string },
  ) => Promise<R[]>;
}> = {
  name: "parallel",
  globals: ({ runtime }) => ({
    parallel: <T, R>(items: readonly T[], worker: (item: T, index: number) => Promise<R> | R, fanOutOptions: { label?: string } = {}) =>
      runParallel(runtime, items, worker, fanOutOptions.label),
  }),
};

export async function runParallel<T, R>(
  runtime: ActiveWorkflowRuntime,
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R> | R,
  label: string | undefined,
): Promise<R[]> {
  const fanOut: WorkflowFanOutSnapshot = {
    id: runtime.snapshot.fanOuts.length + 1,
    label: label ?? `parallel ${String(runtime.snapshot.fanOuts.length + 1)}`,
    total: items.length,
    running: Math.min(items.length, runtime.options.maxParallelAgents),
    done: 0,
    error: 0,
  };
  runtime.snapshot.fanOuts.push(fanOut);
  appendRunMessage(runtime, {
    phaseIndex: runtime.snapshot.phases.length,
    phase: runtime.snapshot.phases.at(-1),
    level: "info",
    message: `fan-out ${fanOut.label} started with ${String(fanOut.total)} items`,
  });
  runtime.emit();
  return runQueuedParallel(items, runtime.options.maxParallelAgents, async (item, index) => {
    if (index >= runtime.options.maxParallelAgents) {
      fanOut.running++;
      runtime.emit();
    }
    try {
      const result = await fanOutScope.run(fanOut.id, () => worker(item, index));
      fanOut.done++;
      return result;
    } catch (error) {
      fanOut.error++;
      throw error;
    } finally {
      fanOut.running = Math.max(0, fanOut.running - 1);
      runtime.emit();
    }
  });
}

async function runQueuedParallel<T, R>(
  items: readonly T[],
  maxParallelAgents: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  const errors: unknown[] = [];
  let nextIndex = 0;
  const runWorker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex++;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        errors.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(maxParallelAgents, items.length) }, () => runWorker()));
  if (errors.length > 0) throw errors[0];
  return results;
}
