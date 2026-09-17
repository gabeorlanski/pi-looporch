/** Provides visible workflow run behavior. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BackgroundWorkflowRun } from "../workflow/background-runs.ts";
import { errorMessage } from "../errors.ts";
import { workflowAbortedHandoffPrompt, workflowFailureHandoffPrompt } from "../prompt-templates.ts";
import type { WorkflowAgent, WorkflowLLM, WorkflowSnapshot } from "../runtime/types.ts";
import { createInitialWorkflowSnapshot } from "../runtime/snapshot.ts";
import { workflowSnapshotPath } from "../workflow/outputs.ts";
import { WorkflowInputError } from "../workflow/input-contract.ts";
import { readWorkflowRunRecord } from "../workflow/run-record.ts";
import { prepareWorkflowResume, prepareWorkflowRun, startPreparedWorkflowRun, type PreparedWorkflowRun } from "../workflow/start.ts";
import { beginDynamicWorkflow, clearRunningWorkflowUi, updateRunningWorkflowUi } from "./running-workflow-ui.ts";
import { extensionSessionScope } from "./session-scope.ts";
import { workflowCompletionReviewPrompt } from "./workflow-completion.ts";
import { sendWorkflowUserMessage, type SendWorkflowUserMessage } from "./workflow-user-message.ts";

interface VisibleWorkflowRunOptions {
  ctx: ExtensionContext;
  agent: WorkflowAgent;
  llm: WorkflowLLM;
  signal?: AbortSignal;
  abortWorkflow?: () => void;
  sendUserMessage: SendWorkflowUserMessage;
  onSnapshot?: (snapshot: WorkflowSnapshot, prepared: PreparedWorkflowRun, run: BackgroundWorkflowRun) => void;
}

export interface StartVisibleWorkflowRunOptions extends VisibleWorkflowRunOptions {
  cwd: string;
  workflowName: string;
  input: unknown;
  agentDir: string;
}

export interface VisibleWorkflowRun {
  prepared: PreparedWorkflowRun;
  run: BackgroundWorkflowRun;
  isSessionClosing: () => boolean;
}

export type VisibleWorkflowAbortStatus = "abort-requested" | "already-aborting" | "already-aborted" | "already-finished";

export interface VisibleWorkflowAbort {
  status: VisibleWorkflowAbortStatus;
  runId: string;
  workflowName: string;
  outputsDir: string;
  snapshotPath: string;
}

export interface ResumeVisibleWorkflowRunOptions extends VisibleWorkflowRunOptions {
  cwd: string;
  runId: string;
  agentDir: string;
}

/** Starts the visible lifecycle for a workflow that has already been prepared at the command boundary. */
export interface StartVisiblePreparedWorkflowRunOptions extends VisibleWorkflowRunOptions {
  prepared: PreparedWorkflowRun;
}

interface TrackedVisibleWorkflowRun extends VisibleWorkflowRun {
  cleanup: () => void;
  markSessionClosing: () => void;
}

const visibleWorkflowRunsByScope = new Map<string, Map<string, TrackedVisibleWorkflowRun>>();

/** Provides the startVisibleWorkflowRun function contract. */
export async function startVisibleWorkflowRun(options: StartVisibleWorkflowRunOptions): Promise<VisibleWorkflowRun> {
  const prepared = await prepareWorkflowRun({
    cwd: options.cwd,
    workflowName: options.workflowName,
    input: options.input,
    agentDir: options.agentDir,
  });
  return startVisiblePreparedWorkflowRun({ ...options, prepared });
}

/** Resumes a failed or aborted visible workflow run in its owning live Pi session. */
export async function resumeVisibleWorkflowRun(options: ResumeVisibleWorkflowRunOptions): Promise<VisibleWorkflowRun> {
  const prepared = await prepareWorkflowResume({
    cwd: options.cwd,
    runId: options.runId,
    ownerSessionId: options.ctx.sessionManager.getSessionId(),
    agentDir: options.agentDir,
  });
  return startVisiblePreparedWorkflowRun({ ...options, prepared });
}

/** Starts a prepared workflow and owns its visible Pi lifecycle. */
export async function startVisiblePreparedWorkflowRun(options: StartVisiblePreparedWorkflowRunOptions): Promise<VisibleWorkflowRun> {
  const { prepared } = options;
  const showRunningUi = options.ctx.mode === "tui";
  const ownerSessionId = options.ctx.sessionManager.getSessionId();
  const scope = extensionSessionScope(options.ctx);
  const activeWorkflow = showRunningUi ? beginDynamicWorkflow(options.ctx) : undefined;
  let run: BackgroundWorkflowRun | undefined;
  let runId: string | undefined;
  let cleaned = false;
  let sessionClosing = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    untrackVisibleWorkflowRun(scope, runId);
    activeWorkflow?.done();
    if (showRunningUi) clearRunningWorkflowUi(options.ctx, runId);
  };
  try {
    runId = prepared.runId;
    const abortWorkflow = options.abortWorkflow ?? (() => run?.abort());
    if (showRunningUi) {
      updateRunningWorkflowUi(options.ctx, {
        runId,
        snapshot: createInitialWorkflowSnapshot(prepared.workflowName, prepared.workflow.metadata, prepared.input),
        abortWorkflow,
      });
    }
    run = await startPreparedWorkflowRun({
      prepared,
      agent: options.agent,
      llm: options.llm,
      ownerSessionId,
      signal: options.signal,
      onSnapshot: (snapshot) => {
        if (!run || cleaned || sessionClosing) return;
        if (showRunningUi) updateRunningWorkflowUi(options.ctx, { runId: prepared.runId, snapshot, abortWorkflow });
        options.onSnapshot?.(snapshot, prepared, run);
      },
    });
    const visible: TrackedVisibleWorkflowRun = {
      prepared,
      run,
      cleanup,
      isSessionClosing: () => sessionClosing,
      markSessionClosing: () => {
        sessionClosing = true;
      },
    };
    trackVisibleWorkflowRun(options.ctx, visible);
    void settleVisibleWorkflowRun(options.ctx, visible, options.sendUserMessage);
    return visible;
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** Requests cooperative cancellation for one visible workflow run owned by this live Pi session. */
export async function abortVisibleWorkflowRun(ctx: ExtensionContext, runId: string): Promise<VisibleWorkflowAbort> {
  const visible = visibleWorkflowRunsByScope.get(extensionSessionScope(ctx))?.get(runId);
  if (visible) {
    const abortRequested = visible.run.abort();
    const status = visible.run.status();
    return {
      status: abortRequested
        ? "abort-requested"
        : status === "aborted"
          ? "already-aborted"
          : status === "running"
            ? "already-aborting"
            : "already-finished",
      runId,
      workflowName: visible.prepared.workflowName,
      outputsDir: visible.run.outputsDir,
      snapshotPath: workflowSnapshotPath(visible.run.outputsDir),
    };
  }

  const record = await readWorkflowRunRecord(ctx.cwd, ctx.sessionManager.getSessionId(), runId);
  if (!record) throw new Error(`Workflow run '${runId}' was not found in the current live session.`);
  if (record.ownerProcessId !== process.pid) throw new Error(`Workflow run '${runId}' belongs to a different Pi process.`);
  if (record.status === "running") throw new Error(`Workflow run '${runId}' is no longer controllable by this session.`);
  return {
    status: record.status === "aborted" ? "already-aborted" : "already-finished",
    runId,
    workflowName: record.workflowName,
    outputsDir: record.outputsDir,
    snapshotPath: workflowSnapshotPath(record.outputsDir),
  };
}

/** Provides the abortVisibleWorkflowRuns function contract. */
export async function abortVisibleWorkflowRuns(ctx: ExtensionContext): Promise<void> {
  const runs = [...(visibleWorkflowRunsByScope.get(extensionSessionScope(ctx))?.values() ?? [])];
  for (const run of runs) run.markSessionClosing();
  for (const { run } of runs) run.abort();
  await Promise.allSettled(runs.map(({ run }) => run.finished));
  for (const run of runs) run.cleanup();
  if (runs.length === 0) clearRunningWorkflowUi(ctx);
}

function trackVisibleWorkflowRun(ctx: ExtensionContext, run: TrackedVisibleWorkflowRun): void {
  const scope = extensionSessionScope(ctx);
  const runs = visibleWorkflowRunsByScope.get(scope) ?? new Map<string, TrackedVisibleWorkflowRun>();
  runs.set(run.run.runId, run);
  visibleWorkflowRunsByScope.set(scope, runs);
}

async function settleVisibleWorkflowRun(
  ctx: ExtensionContext,
  visible: TrackedVisibleWorkflowRun,
  sendUserMessage: SendWorkflowUserMessage,
): Promise<void> {
  try {
    const result = await visible.run.finished;
    if (visible.isSessionClosing()) return;
    try {
      ctx.ui.notify(`Workflow '${result.workflowName}' complete.`, "info");
      sendWorkflowUserMessage(ctx, sendUserMessage, workflowCompletionReviewPrompt(result), "steer");
    } catch (error) {
      if (!visible.isSessionClosing()) {
        ctx.ui.notify(`Workflow '${result.workflowName}' completed, but completion handling failed: ${errorMessage(error)}`, "error");
      }
    }
  } catch (error) {
    if (!visible.isSessionClosing()) {
      if (visible.run.status() === "aborted") abortVisibleWorkflowRunHandoff(ctx, visible, sendUserMessage);
      else failVisibleWorkflowRun(ctx, visible.prepared.workflowName, visible.prepared.runId, error, sendUserMessage);
    }
  } finally {
    visible.cleanup();
  }
}

function abortVisibleWorkflowRunHandoff(
  ctx: ExtensionContext,
  visible: TrackedVisibleWorkflowRun,
  sendUserMessage: SendWorkflowUserMessage,
): void {
  const { prepared, run } = visible;
  try {
    ctx.ui.notify(`Workflow '${prepared.workflowName}' aborted.`, "warning");
    sendWorkflowUserMessage(
      ctx,
      sendUserMessage,
      workflowAbortedHandoffPrompt({
        workflowName: prepared.workflowName,
        runId: prepared.runId,
        outputsDir: run.outputsDir,
        snapshotPath: workflowSnapshotPath(run.outputsDir),
        sessionLogDir: run.sessionLogDir,
      }),
      "steer",
    );
  } catch (handlingError) {
    ctx.ui.notify(`Workflow '${prepared.workflowName}' was aborted, but abort handling failed: ${errorMessage(handlingError)}`, "error");
  }
}

function failVisibleWorkflowRun(
  ctx: ExtensionContext,
  workflowName: string,
  runId: string,
  error: unknown,
  sendUserMessage: SendWorkflowUserMessage,
): void {
  const message = error instanceof WorkflowInputError ? error.message : `Workflow '${workflowName}' failed: ${errorMessage(error)}`;
  try {
    ctx.ui.notify(message, error instanceof WorkflowInputError ? "warning" : "error");
    sendWorkflowUserMessage(ctx, sendUserMessage, workflowFailureHandoffPrompt(workflowName, message, runId), "steer");
  } catch (handlingError) {
    ctx.ui.notify(`Workflow '${workflowName}' failed, but failure handling failed: ${errorMessage(handlingError)}`, "error");
  }
}

function untrackVisibleWorkflowRun(scope: string, runId: string | undefined): void {
  if (!runId) return;
  const runs = visibleWorkflowRunsByScope.get(scope);
  runs?.delete(runId);
  if (runs?.size === 0) visibleWorkflowRunsByScope.delete(scope);
}
