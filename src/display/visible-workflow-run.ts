import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BackgroundWorkflowRun } from "../background-runs.ts";
import type { WorkflowAgent, WorkflowSnapshot } from "../runtime/types.ts";
import { prepareWorkflowRun, startPreparedWorkflowRun, type PreparedWorkflowRun } from "../workflow/start.ts";
import { beginDynamicWorkflow, clearRunningWorkflowUi, updateRunningWorkflowUi } from "./running-workflow-ui.ts";

export interface StartVisibleWorkflowRunOptions {
  ctx: ExtensionContext;
  cwd: string;
  workflowName: string;
  input: unknown;
  agentDir: string;
  agent: WorkflowAgent;
  signal?: AbortSignal;
  abortWorkflow?: () => void;
  onSnapshot?: (snapshot: WorkflowSnapshot, prepared: PreparedWorkflowRun, run: BackgroundWorkflowRun) => void;
}

export interface VisibleWorkflowRun {
  prepared: PreparedWorkflowRun;
  run: BackgroundWorkflowRun;
  cleanup: () => void;
}

export async function startVisibleWorkflowRun(options: StartVisibleWorkflowRunOptions): Promise<VisibleWorkflowRun> {
  const showRunningUi = options.ctx.mode === "tui";
  const ownerSessionId = options.ctx.sessionManager.getSessionId();
  const activeWorkflow = showRunningUi ? beginDynamicWorkflow(options.ctx) : undefined;
  let run: BackgroundWorkflowRun | undefined;
  let runId: string | undefined;
  const cleanup = (): void => {
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
        if (!run) return;
        if (showRunningUi) updateRunningWorkflowUi(options.ctx, { runId: prepared.runId, snapshot, abortWorkflow });
        options.onSnapshot?.(snapshot, prepared, run);
      },
    });
    return { prepared, run, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
