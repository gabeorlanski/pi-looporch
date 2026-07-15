/** Provides running workflow ui behavior. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, type TUI } from "@earendil-works/pi-tui";
import { readActiveWorkflowSnapshots } from "../workflow/active-run-snapshots.ts";
import type { WorkflowSnapshot } from "../runtime/types.ts";
import { extensionSessionScope } from "./session-scope.ts";
import { WorkflowInspector } from "./workflow-inspector.ts";
import { WorkflowInspectorModel } from "./workflow-inspector-model.ts";
import { fmtCostUsd, fmtTokens, glyph, workflowTuiTheme } from "./workflow-tui-format.ts";
import { WorkflowWidget } from "./workflow-widget.ts";

const RUNNING_WORKFLOW_WIDGET = "pi-workflow-running";
const RUNNING_WORKFLOW_STATUS = "workflow";
const ANIMATION_INTERVAL_MS = 800;
const REHYDRATED_WORKFLOW_REFRESH_MS = 1000;

interface RunningWorkflowRunState {
  runId: string;
  model: WorkflowInspectorModel;
  abortWorkflow?: () => void;
}

interface RunningWorkflowUiState {
  runs: Map<string, RunningWorkflowRunState>;
  activeRunId: string;
  armed: boolean;
  overlayOpen: boolean;
  tui?: TUI;
  unsubscribeInput?: () => void;
  animationTimer?: ReturnType<typeof setInterval>;
}

export interface RunningWorkflowUiUpdate {
  runId: string;
  snapshot: WorkflowSnapshot;
  abortWorkflow?: () => void;
}

interface RefreshState {
  cwd: string;
  ownerSessionId: string;
  disposed: boolean;
  timer?: ReturnType<typeof setInterval>;
}

const dynamicWorkflowCounts = new WeakMap<ExtensionContext, number>();
const runningWorkflowUiStates = new WeakMap<ExtensionContext, RunningWorkflowUiState>();
const runningWorkflowUiStatesByScope = new Map<string, RunningWorkflowUiState>();
const refreshStatesByScope = new Map<string, RefreshState>();

/** Provides the beginDynamicWorkflow function contract. */
export function beginDynamicWorkflow(ctx: ExtensionContext): { done: () => void } {
  let done = false;
  dynamicWorkflowCounts.set(ctx, dynamicWorkflowCount(ctx) + 1);
  return {
    done() {
      if (done) return;
      done = true;
      const nextCount = Math.max(0, dynamicWorkflowCount(ctx) - 1);
      if (nextCount === 0) dynamicWorkflowCounts.delete(ctx);
      else dynamicWorkflowCounts.set(ctx, nextCount);
    },
  };
}

/** Provides the restoreRunningWorkflowUi function contract. */
export async function restoreRunningWorkflowUi(ctx: ExtensionContext): Promise<number> {
  if (ctx.mode !== "tui") return 0;
  const scope = extensionSessionScope(ctx);
  const state = refreshStatesByScope.get(scope) ?? {
    cwd: ctx.cwd,
    ownerSessionId: ctx.sessionManager.getSessionId(),
    disposed: false,
  };
  refreshStatesByScope.set(scope, state);
  const restoredCount = await refreshUi(ctx, state);
  if (restoredCount > 0 && !state.disposed && !state.timer) {
    state.timer = setInterval(() => {
      void refreshUi(ctx, state);
    }, REHYDRATED_WORKFLOW_REFRESH_MS);
    state.timer.unref();
  } else if (restoredCount === 0) {
    disposeRefreshState(scope);
  }
  return restoredCount;
}

/** Provides the updateRunningWorkflowUi function contract. */
export function updateRunningWorkflowUi(ctx: ExtensionContext, update: RunningWorkflowUiUpdate): void {
  const existing = runningWorkflowUiStates.get(ctx);
  const state = existing ?? installRunningWorkflowUi(ctx, update);
  if (existing) {
    const run = existing.runs.get(update.runId);
    if (run) {
      run.model.update(update.snapshot);
      run.abortWorkflow = update.abortWorkflow;
    } else {
      existing.runs.set(update.runId, workflowRunState(update));
    }
    existing.activeRunId = update.runId;
  }
  updateWorkflowStatus(ctx, state);
  requestRender(state);
}

/** Provides the openRunningWorkflowInspector function contract. */
export async function openRunningWorkflowInspector(ctx: ExtensionContext): Promise<boolean> {
  const state = findRunningWorkflowUiState(ctx);
  if (!state || state.runs.size === 0) return false;
  await openWorkflowInspector(ctx, state, activeRun(state));
  return true;
}

/** Provides the clearRunningWorkflowUi function contract. */
export function clearRunningWorkflowUi(ctx: ExtensionContext, runId?: string): void {
  const scope = extensionSessionScope(ctx);
  const state = runningWorkflowUiStates.get(ctx) ?? runningWorkflowUiStatesByScope.get(scope);
  if (state && runId) removeWorkflowRun(state, runId);
  if (state && state.runs.size > 0) {
    updateWorkflowStatus(ctx, state);
    requestRender(state);
    return;
  }
  if (dynamicWorkflowCount(ctx) > 0) {
    if (state) {
      updateWorkflowStatus(ctx, state);
      requestRender(state);
    }
    return;
  }
  if (state?.animationTimer) clearInterval(state.animationTimer);
  disposeRefreshState(scope);
  state?.unsubscribeInput?.();
  runningWorkflowUiStates.delete(ctx);
  if (state && runningWorkflowUiStatesByScope.get(scope) === state) runningWorkflowUiStatesByScope.delete(scope);
  ctx.ui.setStatus(RUNNING_WORKFLOW_STATUS, undefined);
  ctx.ui.setWidget(RUNNING_WORKFLOW_WIDGET, undefined);
}

async function refreshUi(ctx: ExtensionContext, state: RefreshState): Promise<number> {
  const snapshots = await readActiveWorkflowSnapshots(state.cwd, state.ownerSessionId);
  if (state.disposed) return 0;
  for (const snapshot of snapshots) updateRunningWorkflowUi(ctx, snapshot);
  if (snapshots.length === 0) clearRunningWorkflowUi(ctx);
  return snapshots.length;
}

function disposeRefreshState(scope: string): void {
  const state = refreshStatesByScope.get(scope);
  if (!state) return;
  state.disposed = true;
  if (state.timer) clearInterval(state.timer);
  refreshStatesByScope.delete(scope);
}

function installRunningWorkflowUi(ctx: ExtensionContext, update: RunningWorkflowUiUpdate): RunningWorkflowUiState {
  const state: RunningWorkflowUiState = {
    runs: new Map([[update.runId, workflowRunState(update)]]),
    activeRunId: update.runId,
    armed: false,
    overlayOpen: false,
  };
  runningWorkflowUiStates.set(ctx, state);
  runningWorkflowUiStatesByScope.set(extensionSessionScope(ctx), state);
  installWorkflowWidget(ctx, state);
  installWorkflowInputHandler(ctx, state);
  updateWorkflowStatus(ctx, state);
  state.animationTimer = setInterval(() => {
    for (const run of state.runs.values()) run.model.advanceFrame();
    requestRender(state);
  }, ANIMATION_INTERVAL_MS);
  state.animationTimer.unref();
  return state;
}

function removeWorkflowRun(state: RunningWorkflowUiState, runId: string): void {
  state.runs.delete(runId);
  if (state.activeRunId === runId) state.activeRunId = state.runs.keys().next().value ?? runId;
}

function installWorkflowWidget(ctx: ExtensionContext, state: RunningWorkflowUiState): void {
  ctx.ui.setWidget(
    RUNNING_WORKFLOW_WIDGET,
    (tui, theme) => {
      state.tui = tui;
      return new WorkflowWidget(
        () => activeRun(state).model,
        workflowTuiTheme(theme),
        () => state.armed,
      );
    },
    { placement: "belowEditor" },
  );
}

function installWorkflowInputHandler(ctx: ExtensionContext, state: RunningWorkflowUiState): void {
  state.unsubscribeInput = ctx.ui.onTerminalInput((data) => {
    if (state.overlayOpen) return undefined;
    if (!state.armed) {
      if (matchesKey(data, "down") && ctx.ui.getEditorText() === "") {
        state.armed = true;
        requestRender(state);
        return { consume: true };
      }
      return undefined;
    }
    if (matchesKey(data, "enter")) {
      void openWorkflowInspector(ctx, state, activeRun(state));
      return { consume: true };
    }
    if (matchesKey(data, "up") || matchesKey(data, "escape")) {
      state.armed = false;
      requestRender(state);
      return { consume: true };
    }
    state.armed = false;
    requestRender(state);
    return undefined;
  });
}

async function openWorkflowInspector(ctx: ExtensionContext, state: RunningWorkflowUiState, run: RunningWorkflowRunState): Promise<void> {
  if (state.overlayOpen) return;
  state.overlayOpen = true;
  state.armed = false;
  try {
    await ctx.ui.custom<undefined>(
      (tui, theme, _keybindings, done) => {
        state.tui = tui;
        const inspector = new WorkflowInspector(run.model, workflowTuiTheme(theme), () => tui.terminal.rows);
        inspector.onClose = () => done(undefined);
        inspector.onAbort = () => run.abortWorkflow?.();
        return inspector;
      },
      { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%" } },
    );
  } finally {
    state.overlayOpen = false;
    requestRender(state);
  }
}

function workflowRunState(update: RunningWorkflowUiUpdate): RunningWorkflowRunState {
  return {
    runId: update.runId,
    model: new WorkflowInspectorModel(update.snapshot),
    abortWorkflow: update.abortWorkflow,
  };
}

function findRunningWorkflowUiState(ctx: ExtensionContext): RunningWorkflowUiState | undefined {
  const local = runningWorkflowUiStates.get(ctx);
  if (local && local.runs.size > 0) return local;
  const scoped = runningWorkflowUiStatesByScope.get(extensionSessionScope(ctx));
  return scoped && scoped.runs.size > 0 ? scoped : undefined;
}

function activeRun(state: RunningWorkflowUiState): RunningWorkflowRunState {
  const run = state.runs.get(state.activeRunId) ?? state.runs.values().next().value;
  if (!run) throw new Error("Running workflow UI has no active workflow run");
  return run;
}

function updateWorkflowStatus(ctx: ExtensionContext, state: RunningWorkflowUiState): void {
  const workflows = [...state.runs.values()].map((run) => run.model.workflow());
  const inputTokens = workflows.reduce((total, workflow) => total + workflow.inputTokens, 0);
  const cachedTokens = workflows.reduce((total, workflow) => total + workflow.cachedTokens, 0);
  const outputTokens = workflows.reduce((total, workflow) => total + workflow.outputTokens, 0);
  const costUsd = workflows.reduce((total, workflow) => total + workflow.costUsd, 0);
  const costIncomplete = workflows.some((workflow) => workflow.costIncomplete);
  const prefix = workflows.length === 1 ? "Workflow" : `${String(workflows.length)} workflows`;
  ctx.ui.setStatus(
    RUNNING_WORKFLOW_STATUS,
    `${prefix} ${glyph.mid} in ${fmtTokens(inputTokens)} ${glyph.mid} cached ${fmtTokens(cachedTokens)} ${glyph.mid} out ${fmtTokens(outputTokens)} ${glyph.mid} ${fmtCostUsd(costUsd, costIncomplete)}`,
  );
}

function requestRender(state: RunningWorkflowUiState): void {
  state.tui?.requestRender();
}

function dynamicWorkflowCount(ctx: ExtensionContext): number {
  return dynamicWorkflowCounts.get(ctx) ?? 0;
}
