import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, type TUI } from "@earendil-works/pi-tui";
import type { WorkflowSnapshot } from "../runtime/types.ts";
import { WorkflowInspector } from "./workflow-inspector.ts";
import { WorkflowInspectorModel } from "./workflow-inspector-model.ts";
import { workflowTuiTheme } from "./workflow-tui-format.ts";
import { WorkflowWidget } from "./workflow-widget.ts";

const RUNNING_WORKFLOW_WIDGET = "pi-workflow-running";
const RUNNING_WORKFLOW_STATUS = "workflow";
const ANIMATION_INTERVAL_MS = 800;

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
  statusLine?: string;
  tui?: TUI;
  unsubscribeInput?: () => void;
  animationTimer?: ReturnType<typeof setInterval>;
}

export interface RunningWorkflowUiUpdate {
  runId: string;
  snapshot: WorkflowSnapshot;
  abortWorkflow: () => void;
}

const dynamicWorkflowCounts = new WeakMap<ExtensionContext, number>();
const runningWorkflowUiStates = new WeakMap<ExtensionContext, RunningWorkflowUiState>();

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

export function updateRunningWorkflowUi(ctx: ExtensionCommandContext, update: RunningWorkflowUiUpdate): void {
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
  updateRunningWorkflowStatus(ctx, state);
  requestRender(state);
}

export function clearRunningWorkflowUi(ctx: ExtensionCommandContext, runId?: string): void {
  const state = runningWorkflowUiStates.get(ctx);
  if (state && runId) removeWorkflowRun(state, runId);
  if (dynamicWorkflowCount(ctx) > 0) {
    if (state) {
      updateRunningWorkflowStatus(ctx, state);
      requestRender(state);
    }
    return;
  }
  if (state?.animationTimer) clearInterval(state.animationTimer);
  state?.unsubscribeInput?.();
  runningWorkflowUiStates.delete(ctx);
  ctx.ui.setStatus(RUNNING_WORKFLOW_STATUS, undefined);
  ctx.ui.setWidget(RUNNING_WORKFLOW_WIDGET, undefined);
}

function installRunningWorkflowUi(ctx: ExtensionCommandContext, update: RunningWorkflowUiUpdate): RunningWorkflowUiState {
  const state: RunningWorkflowUiState = {
    runs: new Map([[update.runId, workflowRunState(update)]]),
    activeRunId: update.runId,
    armed: false,
    overlayOpen: false,
  };
  runningWorkflowUiStates.set(ctx, state);
  installWorkflowWidget(ctx, state);
  installWorkflowInputHandler(ctx, state);
  state.animationTimer = setInterval(() => {
    for (const run of state.runs.values()) run.model.advanceFrame();
    requestRender(state);
  }, ANIMATION_INTERVAL_MS);
  return state;
}

function removeWorkflowRun(state: RunningWorkflowUiState, runId: string): void {
  state.runs.delete(runId);
  if (state.activeRunId === runId) state.activeRunId = state.runs.keys().next().value ?? runId;
}

function installWorkflowWidget(ctx: ExtensionCommandContext, state: RunningWorkflowUiState): void {
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

function installWorkflowInputHandler(ctx: ExtensionCommandContext, state: RunningWorkflowUiState): void {
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

async function openWorkflowInspector(
  ctx: ExtensionCommandContext,
  state: RunningWorkflowUiState,
  run: RunningWorkflowRunState,
): Promise<void> {
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

function activeRun(state: RunningWorkflowUiState): RunningWorkflowRunState {
  const run = state.runs.get(state.activeRunId) ?? state.runs.values().next().value;
  if (!run) throw new Error("Running workflow UI has no active workflow run");
  return run;
}

function requestRender(state: RunningWorkflowUiState): void {
  state.tui?.requestRender();
}

function dynamicWorkflowCount(ctx: ExtensionContext): number {
  return dynamicWorkflowCounts.get(ctx) ?? 0;
}

function dynamicWorkflowStatusLine(count: number): string {
  return `Waiting for ${String(count)} dynamic workflow${count === 1 ? "" : "s"} to finish`;
}

function updateRunningWorkflowStatus(ctx: ExtensionContext, state: RunningWorkflowUiState): void {
  const count = dynamicWorkflowCount(ctx);
  const workflow = activeRun(state).model.workflow();
  const fallback = `${workflow.name}: ${workflow.status.toUpperCase()} · ${String(workflow.agentsDone)}/${String(workflow.agentsTotal)} agents · ${String(workflow.tokensTotal)} tokens`;
  const statusLine = count > 0 ? dynamicWorkflowStatusLine(count) : fallback;
  if (statusLine === state.statusLine) return;
  state.statusLine = statusLine;
  ctx.ui.setStatus(RUNNING_WORKFLOW_STATUS, statusLine);
}
