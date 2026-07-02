import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readWorkflowStatusList, type WorkflowStatusQuery } from "../workflow/status.ts";
import { extensionSessionScope } from "./session-scope.ts";
import { workflowMonitorWidgetLines } from "./workflow-status.ts";

const WORKFLOW_MONITOR_WIDGET = "workflow-monitor";
const WORKFLOW_MONITOR_REFRESH_MS = 3000;

interface WorkflowMonitorState {
  timer: ReturnType<typeof setInterval>;
  cwd: string;
  ownerSessionId: string;
  disposed: boolean;
}

const monitorStatesByScope = new Map<string, WorkflowMonitorState>();

export function startWorkflowMonitorWidget(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  const scope = extensionSessionScope(ctx);
  if (monitorStatesByScope.has(scope)) return;
  const state: WorkflowMonitorState = {
    timer: setInterval(() => {
      void refreshWorkflowMonitorWidget(ctx, state);
    }, WORKFLOW_MONITOR_REFRESH_MS),
    cwd: ctx.cwd,
    ownerSessionId: ctx.sessionManager.getSessionId(),
    disposed: false,
  };
  state.timer.unref();
  monitorStatesByScope.set(scope, state);
  void refreshWorkflowMonitorWidget(ctx, state);
}

export function stopWorkflowMonitorWidget(ctx: ExtensionContext): void {
  disposeWorkflowMonitorState(ctx);
  ctx.ui.setWidget(WORKFLOW_MONITOR_WIDGET, undefined);
}

async function refreshWorkflowMonitorWidget(ctx: ExtensionContext, state: WorkflowMonitorState): Promise<void> {
  if (workflowMonitorStateDisposed(state)) return;
  const query: WorkflowStatusQuery = {
    scope: "project",
    ownerSessionId: state.ownerSessionId,
    ref: "latest",
    includeCompleted: false,
    now: Date.now(),
  };
  const statuses = await readWorkflowStatusList(state.cwd, query).catch(() => []);
  if (workflowMonitorStateDisposed(state)) return;
  const lines = workflowMonitorWidgetLines(statuses, query.ownerSessionId);
  ctx.ui.setWidget(WORKFLOW_MONITOR_WIDGET, lines.length > 0 ? lines : undefined, { placement: "belowEditor" });
}

function workflowMonitorStateDisposed(state: WorkflowMonitorState): boolean {
  return state.disposed;
}

function disposeWorkflowMonitorState(ctx: ExtensionContext): void {
  const scope = extensionSessionScope(ctx);
  const state = monitorStatesByScope.get(scope);
  if (!state) return;
  state.disposed = true;
  clearInterval(state.timer);
  monitorStatesByScope.delete(scope);
}
