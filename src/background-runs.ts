import type { RunWorkflowOptions, WorkflowRunResult, WorkflowSnapshot } from "./runtime/types.ts";
import { runWorkflowFromDirectory } from "./runtime/run.ts";
import { writeWorkflowSessionSummary } from "./session-logs.ts";
import { createWorkflowOutputsDir } from "./workflow/outputs.ts";

export interface StartBackgroundWorkflowRunOptions extends RunWorkflowOptions {
  runId: string;
}

export interface BackgroundWorkflowRunResult extends WorkflowRunResult {
  sessionLogDir: string;
}

export interface BackgroundWorkflowRun {
  runId: string;
  workflowName: string;
  outputsDir: string;
  abort: () => void;
  snapshot: () => WorkflowSnapshot | undefined;
  finished: Promise<BackgroundWorkflowRunResult>;
}

export async function startBackgroundWorkflowRun(options: StartBackgroundWorkflowRunOptions): Promise<BackgroundWorkflowRun> {
  const outputsDir = options.outputsDir ?? (await createWorkflowOutputsDir(options.runId));
  const controller = new AbortController();
  let latestSnapshot: WorkflowSnapshot | undefined;
  const abortWorkflow = (): void => {
    if (!controller.signal.aborted) controller.abort();
  };
  const removeParentAbortListener = linkAbortSignal(options.signal, abortWorkflow);
  const finished = runWorkflowFromDirectory({
    ...options,
    outputsDir,
    signal: controller.signal,
    onSnapshot: (snapshot) => {
      latestSnapshot = snapshot;
      options.onSnapshot?.(snapshot);
    },
  })
    .then(async (result) => ({
      ...result,
      sessionLogDir: await writeWorkflowSessionSummary({
        cwd: options.cwd,
        parentId: options.runId,
        snapshot: result.snapshot,
        resultPath: result.resultPath,
      }),
    }))
    .catch(async (error: unknown) => {
      if (latestSnapshot) {
        await writeWorkflowSessionSummary({
          cwd: options.cwd,
          parentId: options.runId,
          snapshot: latestSnapshot,
          error,
        });
      }
      throw error;
    })
    .finally(() => {
      removeParentAbortListener();
    });
  return {
    runId: options.runId,
    workflowName: options.workflowName,
    outputsDir,
    abort: abortWorkflow,
    snapshot: () => latestSnapshot,
    finished,
  };
}

function linkAbortSignal(signal: AbortSignal | undefined, abortWorkflow: () => void): () => void {
  if (!signal) return () => undefined;
  if (signal.aborted) {
    abortWorkflow();
    return () => undefined;
  }
  signal.addEventListener("abort", abortWorkflow, { once: true });
  return () => signal.removeEventListener("abort", abortWorkflow);
}
