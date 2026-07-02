import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BackgroundWorkflowRun } from "../workflow/background-runs.ts";
import { errorMessage } from "../errors.ts";
import type { WorkflowAgent, WorkflowSnapshot } from "../runtime/types.ts";
import { WorkflowInputError } from "../workflow/input-contract.ts";
import { prepareWorkflowRun, startPreparedWorkflowRun, type PreparedWorkflowRun } from "../workflow/start.ts";
import { beginDynamicWorkflow, clearRunningWorkflowUi, updateRunningWorkflowUi } from "./running-workflow-ui.ts";
import { extensionSessionScope } from "./session-scope.ts";
import { completeMessage, failureMessage } from "./messages.ts";
import { workflowCompletionReviewPrompt } from "./workflow-completion.ts";
import { sendWorkflowUserMessage, type SendWorkflowUserMessage } from "./workflow-user-message.ts";

export interface StartVisibleWorkflowRunOptions {
  ctx: ExtensionContext;
  cwd: string;
  workflowName: string;
  input: unknown;
  agentDir: string;
  agent: WorkflowAgent;
  signal?: AbortSignal;
  abortWorkflow?: () => void;
  sendUserMessage: SendWorkflowUserMessage;
  onSnapshot?: (snapshot: WorkflowSnapshot, prepared: PreparedWorkflowRun, run: BackgroundWorkflowRun) => void;
}

export interface VisibleWorkflowRun {
  prepared: PreparedWorkflowRun;
  run: BackgroundWorkflowRun;
  isSessionClosing: () => boolean;
}

interface TrackedVisibleWorkflowRun extends VisibleWorkflowRun {
  cleanup: () => void;
  markSessionClosing: () => void;
}

const visibleWorkflowRunsByScope = new Map<string, Map<string, TrackedVisibleWorkflowRun>>();

export async function startVisibleWorkflowRun(options: StartVisibleWorkflowRunOptions): Promise<VisibleWorkflowRun> {
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
    const prepared = await prepareWorkflowRun({
      cwd: options.cwd,
      workflowName: options.workflowName,
      input: options.input,
      agentDir: options.agentDir,
    });
    runId = prepared.runId;
    const abortWorkflow = options.abortWorkflow ?? (() => run?.abort());
    if (showRunningUi) {
      updateRunningWorkflowUi(options.ctx, {
        runId,
        snapshot: prepared.initialSnapshot,
        abortWorkflow,
      });
    }
    run = await startPreparedWorkflowRun({
      prepared,
      agent: options.agent,
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
      ctx.ui.notify(completeMessage(result.workflowName), "info");
      sendWorkflowUserMessage(ctx, sendUserMessage, workflowCompletionReviewPrompt(result));
    } catch (error) {
      if (!visible.isSessionClosing()) {
        ctx.ui.notify(`Workflow '${result.workflowName}' completed, but completion handling failed: ${errorMessage(error)}`, "error");
      }
    }
  } catch (error) {
    if (!visible.isSessionClosing()) failVisibleWorkflowRun(ctx, visible.prepared.workflowName, error, sendUserMessage);
  } finally {
    visible.cleanup();
  }
}

function failVisibleWorkflowRun(
  ctx: ExtensionContext,
  workflowName: string,
  error: unknown,
  sendUserMessage: SendWorkflowUserMessage,
): void {
  const message = error instanceof WorkflowInputError ? error.message : failureMessage(workflowName, error);
  try {
    ctx.ui.notify(message, error instanceof WorkflowInputError ? "warning" : "error");
    sendWorkflowUserMessage(ctx, sendUserMessage, message);
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
