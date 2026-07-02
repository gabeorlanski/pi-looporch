import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BackgroundWorkflowRun } from "../workflow/background-runs.ts";
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

interface TrackedVisibleWorkflowRun {
  run: BackgroundWorkflowRun;
  cleanup: () => void;
}

const visibleWorkflowRuns = new WeakMap<ExtensionContext, Map<string, TrackedVisibleWorkflowRun>>();

export async function startVisibleWorkflowRun(options: StartVisibleWorkflowRunOptions): Promise<VisibleWorkflowRun> {
  const showRunningUi = options.ctx.mode === "tui";
  const ownerSessionId = options.ctx.sessionManager.getSessionId();
  const activeWorkflow = showRunningUi ? beginDynamicWorkflow(options.ctx) : undefined;
  let run: BackgroundWorkflowRun | undefined;
  let runId: string | undefined;
  const cleanup = (): void => {
    untrackVisibleWorkflowRun(options.ctx, runId);
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
    const visible = { prepared, run, cleanup };
    trackVisibleWorkflowRun(options.ctx, visible);
    return visible;
  } catch (error) {
    cleanup();
    throw error;
  }
}

export async function abortVisibleWorkflowRuns(ctx: ExtensionContext): Promise<void> {
  const runs = [...(visibleWorkflowRuns.get(ctx)?.values() ?? [])];
  for (const { run } of runs) run.abort();
  await Promise.allSettled(runs.map(({ run }) => run.finished));
  for (const run of runs) run.cleanup();
  if (runs.length === 0) clearRunningWorkflowUi(ctx);
}

function trackVisibleWorkflowRun(ctx: ExtensionContext, run: TrackedVisibleWorkflowRun): void {
  const runs = visibleWorkflowRuns.get(ctx) ?? new Map<string, TrackedVisibleWorkflowRun>();
  runs.set(run.run.runId, run);
  visibleWorkflowRuns.set(ctx, runs);
  void run.run.finished.finally(() => untrackVisibleWorkflowRun(ctx, run.run.runId)).catch(() => undefined);
}

function untrackVisibleWorkflowRun(ctx: ExtensionContext, runId: string | undefined): void {
  if (!runId) return;
  const runs = visibleWorkflowRuns.get(ctx);
  runs?.delete(runId);
  if (runs?.size === 0) visibleWorkflowRuns.delete(ctx);
}
