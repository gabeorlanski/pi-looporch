import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ProgressDisplay, ProgressTheme } from "./progress.ts";
import { fit } from "./text.ts";

const RUNNING_WORKFLOW_WIDGET = "pi-workflow-running";
const RUNNING_WORKFLOW_STATUS = "workflow";

interface RunningWorkflowUiState {
  displayForWidth: (width: number, theme?: ProgressTheme) => ProgressDisplay;
  requestRender?: () => void;
  statusLine?: string;
}

const dynamicWorkflowCounts = new WeakMap<ExtensionCommandContext, number>();
const runningWorkflowUiStates = new WeakMap<ExtensionCommandContext, RunningWorkflowUiState>();

export function beginDynamicWorkflow(ctx: ExtensionCommandContext): { done: () => void } {
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

export function updateRunningWorkflowUi(
  ctx: ExtensionCommandContext,
  displayForWidth: (width: number, theme?: ProgressTheme) => ProgressDisplay,
): void {
  const existing = runningWorkflowUiStates.get(ctx);
  if (existing) {
    existing.displayForWidth = displayForWidth;
    updateRunningWorkflowStatus(ctx, existing);
    existing.requestRender?.();
    return;
  }

  const state: RunningWorkflowUiState = { displayForWidth };
  runningWorkflowUiStates.set(ctx, state);
  updateRunningWorkflowStatus(ctx, state);
  ctx.ui.setWidget(
    RUNNING_WORKFLOW_WIDGET,
    (tui, theme) => {
      state.requestRender = () => tui.requestRender();
      return {
        render: (width: number) => {
          const display = state.displayForWidth(width, theme);
          return fitProgressPane(display.widgetLines, width, runningWorkflowPaneHeight(tui.terminal.rows), theme);
        },
        invalidate: () => updateRunningWorkflowStatus(ctx, state),
      };
    },
    { placement: "aboveEditor" },
  );
}

export function clearRunningWorkflowUi(ctx: ExtensionCommandContext): void {
  const state = runningWorkflowUiStates.get(ctx);
  if (dynamicWorkflowCount(ctx) > 0) {
    if (state) updateRunningWorkflowStatus(ctx, state);
    return;
  }
  runningWorkflowUiStates.delete(ctx);
  ctx.ui.setStatus(RUNNING_WORKFLOW_STATUS, undefined);
  ctx.ui.setWidget(RUNNING_WORKFLOW_WIDGET, undefined);
}

function dynamicWorkflowCount(ctx: ExtensionCommandContext): number {
  return dynamicWorkflowCounts.get(ctx) ?? 0;
}

function dynamicWorkflowStatusLine(count: number): string {
  return `Waiting for ${String(count)} dynamic workflow${count === 1 ? "" : "s"} to finish`;
}

function updateRunningWorkflowStatus(ctx: ExtensionCommandContext, state: RunningWorkflowUiState): void {
  const count = dynamicWorkflowCount(ctx);
  const statusLine = count > 0 ? dynamicWorkflowStatusLine(count) : state.displayForWidth(96).statusLine;
  if (statusLine === state.statusLine) return;
  state.statusLine = statusLine;
  ctx.ui.setStatus(RUNNING_WORKFLOW_STATUS, statusLine);
}

function runningWorkflowPaneHeight(termRows: number): number {
  const safeRows = termRows > 0 ? termRows : 32;
  return Math.max(10, Math.min(22, Math.floor(safeRows * 0.42)));
}

function fitProgressPane(lines: string[], width: number, height: number, theme: ProgressTheme): string[] {
  if (lines.length <= height) return fillPane(lines, width, height);
  const hidden = lines.length - height + 1;
  const footer = theme.fg("dim", fit(`  … ${String(hidden)} workflow lines hidden`, width));
  return fillPane([...lines.slice(0, height - 1), footer], width, height);
}

function fillPane(lines: string[], width: number, height: number): string[] {
  const fitted = lines.slice(0, height).map((line) => fit(line, width));
  while (fitted.length < height) fitted.push("");
  return fitted;
}
