/** Provides background runs behavior. */
import type { RunWorkflowOptions, WorkflowRunResult, WorkflowSnapshot } from "../runtime/types.ts";
import { runWorkflowFromDirectory } from "../runtime/run.ts";
import { writeWorkflowSessionSummary } from "../session/logs.ts";
import { registerActiveWorkflowRun, removeActiveWorkflowRun } from "./active-runs.ts";
import { writeWorkflowSnapshot } from "./outputs.ts";
import { createCheckpointCache } from "./checkpoints.ts";
import { writeRunRecord, type RunRecord } from "./run-record.ts";
import { workflowRunDirectory } from "./run-storage.ts";

/** Options for starting a workflow as a persisted background run owned by a Pi session. */
export type WorkflowRunAttempt =
  | { kind: "new" }
  | { kind: "resume"; startedAt: number; resumeCount: number; releaseClaim: () => Promise<void> };

export type StartBackgroundWorkflowRunOptions = Omit<RunWorkflowOptions, "outputsDir" | "checkpoints"> & {
  runId: string;
  ownerSessionId: string;
  attempt: WorkflowRunAttempt;
};

/** Terminal background workflow result plus the persisted child-session summary directory. */
export interface BackgroundWorkflowRunResult extends WorkflowRunResult {
  runId: string;
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
  const outputsDir = workflowRunDirectory(options.cwd, options.ownerSessionId, options.runId);
  const checkpoints = await createCheckpointCache(outputsDir, options.attempt.kind === "resume");
  const startedAt = options.attempt.kind === "resume" ? options.attempt.startedAt : Date.now();
  const runRecord: RunRecord = {
    runId: options.runId,
    workflowName: options.workflowName,
    cwd: options.cwd,
    input: options.input,
    ownerSessionId: options.ownerSessionId,
    ownerProcessId: process.pid,
    startedAt,
    resumeCount: options.attempt.kind === "resume" ? options.attempt.resumeCount : 0,
    status: "running",
  };
  await writeRunRecord(outputsDir, runRecord);
  await registerActiveWorkflowRun(options.cwd, {
    runId: options.runId,
    workflowName: options.workflowName,
    outputsDir,
    startedAt,
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
    checkpoints,
    signal: controller.signal,
    onSnapshot: (snapshot) => {
      latestSnapshot = snapshot;
      snapshotWrite = enqueueSnapshotWrite(snapshotWrite, outputsDir, snapshot);
      options.onSnapshot?.(snapshot);
    },
  })
    .then(async (result) => {
      runRecord.status = "done";
      await writeRunRecord(outputsDir, runRecord);
      return {
        ...result,
        runId: options.runId,
        sessionLogDir: await writeWorkflowSessionSummary({
          cwd: options.cwd,
          parentId: options.runId,
          snapshot: result.snapshot,
          resultPath: result.resultPath,
        }),
      };
    })
    .catch(async (error: unknown) => {
      runRecord.status = controller.signal.aborted ? "aborted" : "error";
      await writeRunRecord(outputsDir, runRecord);
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
      try {
        await removeActiveWorkflowRun(options.cwd, options.runId, options.ownerSessionId);
      } finally {
        if (options.attempt.kind === "resume") await options.attempt.releaseClaim();
      }
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
