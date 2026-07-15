/** Provides workflow monitor widget behavior. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readWorkflowStatusList, type WorkflowStatusQuery } from "../workflow/status.ts";
import { extensionSessionScope } from "./session-scope.ts";
import { workflowMonitorWidgetLines } from "./workflow-status.ts";

const WORKFLOW_MONITOR_WIDGET = "workflow-monitor";
const WORKFLOW_MONITOR_REFRESH_MS = 3000;

interface MonitorState {
  timer: ReturnType<typeof setInterval>;
  cwd: string;
  ownerSessionId: string;
  disposed: boolean;
}

const monitorStatesByScope = new Map<string, MonitorState>();

/** Provides the startWorkflowMonitorWidget function contract. */
export function startWorkflowMonitorWidget(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  const scope = extensionSessionScope(ctx);
  if (monitorStatesByScope.has(scope)) return;
  const state: MonitorState = {
    timer: setInterval(() => {
      void refreshMonitor(ctx, state);
    }, WORKFLOW_MONITOR_REFRESH_MS),
    cwd: ctx.cwd,
    ownerSessionId: ctx.sessionManager.getSessionId(),
    disposed: false,
  };
  state.timer.unref();
  monitorStatesByScope.set(scope, state);
  void refreshMonitor(ctx, state);
}

/** Provides the stopWorkflowMonitorWidget function contract. */
export function stopWorkflowMonitorWidget(ctx: ExtensionContext): void {
  const scope = extensionSessionScope(ctx);
  const state = monitorStatesByScope.get(scope);
  if (state) {
    state.disposed = true;
    clearInterval(state.timer);
    monitorStatesByScope.delete(scope);
  }
  ctx.ui.setWidget(WORKFLOW_MONITOR_WIDGET, undefined);
}

async function refreshMonitor(ctx: ExtensionContext, state: MonitorState): Promise<void> {
  const query: WorkflowStatusQuery = {
    scope: "project",
    ownerSessionId: state.ownerSessionId,
    ref: "latest",
    includeCompleted: false,
    now: Date.now(),
  };
  const statuses = await readWorkflowStatusList(state.cwd, query).catch(() => []);
  if (state.disposed) return;
  const lines = workflowMonitorWidgetLines(statuses, query.ownerSessionId);
  ctx.ui.setWidget(WORKFLOW_MONITOR_WIDGET, lines.length > 0 ? lines : undefined, { placement: "belowEditor" });
}
