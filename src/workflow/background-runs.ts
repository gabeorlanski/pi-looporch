/** Provides background runs behavior. */
import type { RunWorkflowOptions, WorkflowRunResult, WorkflowSnapshot } from "../runtime/types.ts";
import { runWorkflowFromDirectory } from "../runtime/run.ts";
import { writeWorkflowSessionSummary } from "../session/logs.ts";
import { registerActiveWorkflowRun, removeActiveWorkflowRun } from "./active-runs.ts";
import { createWorkflowOutputsDir, writeWorkflowSnapshot } from "./outputs.ts";

/** Options for starting a workflow as a persisted background run owned by a Pi session. */
export interface StartBackgroundWorkflowRunOptions extends RunWorkflowOptions {
  runId: string;
  ownerSessionId: string;
}

/** Terminal background workflow result plus the persisted child-session summary directory. */
export interface BackgroundWorkflowRunResult extends WorkflowRunResult {
  sessionLogDir: string;
}

/** Handle for a running background workflow, including abort, latest snapshot, and completion promise. */
export interface BackgroundWorkflowRun {
  runId: string;
  workflowName: string;
  outputsDir: string;
  abort: () => void;
  snapshot: () => WorkflowSnapshot | undefined;
  finished: Promise<BackgroundWorkflowRunResult>;
}

/** Starts a workflow run, registers it as active, writes snapshots, and cleans up the active record on completion. */
export async function startBackgroundWorkflowRun(options: StartBackgroundWorkflowRunOptions): Promise<BackgroundWorkflowRun> {
  const outputsDir = options.outputsDir ?? (await createWorkflowOutputsDir(options.runId));
  await registerActiveWorkflowRun(options.cwd, {
    runId: options.runId,
    workflowName: options.workflowName,
    outputsDir,
    startedAt: Date.now(),
    ownerSessionId: options.ownerSessionId,
  });
  const controller = new AbortController();
  let latestSnapshot: WorkflowSnapshot | undefined;
  let snapshotWrite: Promise<void> = Promise.resolve();
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
      snapshotWrite = enqueueSnapshotWrite(snapshotWrite, outputsDir, snapshot);
      options.onSnapshot?.(snapshot);
    },
  })
    .then(async (result) => {
      return {
        ...result,
        sessionLogDir: await writeWorkflowSessionSummary({
          cwd: options.cwd,
          parentId: options.runId,
          snapshot: result.snapshot,
          resultPath: result.resultPath,
        }),
      };
    })
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
    .finally(async () => {
      removeParentAbortListener();
      await snapshotWrite;
      await removeActiveWorkflowRun(options.cwd, options.runId);
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

function enqueueSnapshotWrite(previous: Promise<void>, outputsDir: string, snapshot: WorkflowSnapshot): Promise<void> {
  return previous
    .catch(() => undefined)
    .then(() => writeWorkflowSnapshot(outputsDir, snapshot))
    .catch(() => undefined);
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
