import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readWorkflowStatusList, type WorkflowStatusQuery } from "../workflow/status.ts";
import { workflowMonitorWidgetLines } from "./workflow-status.ts";

const WORKFLOW_MONITOR_WIDGET = "workflow-monitor";
const WORKFLOW_MONITOR_REFRESH_MS = 3000;

const monitorTimers = new WeakMap<ExtensionContext, ReturnType<typeof setInterval>>();

export function startWorkflowMonitorWidget(ctx: ExtensionContext): void {
  if (!ctx.hasUI || monitorTimers.has(ctx)) return;
  void refreshWorkflowMonitorWidget(ctx);
  const timer = setInterval(() => {
    void refreshWorkflowMonitorWidget(ctx);
  }, WORKFLOW_MONITOR_REFRESH_MS);
  timer.unref();
  monitorTimers.set(ctx, timer);
}

export function stopWorkflowMonitorWidget(ctx: ExtensionContext): void {
  const timer = monitorTimers.get(ctx);
  if (timer) clearInterval(timer);
  monitorTimers.delete(ctx);
  ctx.ui.setWidget(WORKFLOW_MONITOR_WIDGET, undefined);
}

async function refreshWorkflowMonitorWidget(ctx: ExtensionContext): Promise<void> {
  const query: WorkflowStatusQuery = {
    scope: "project",
    ownerSessionId: ctx.sessionManager.getSessionId(),
    ref: "latest",
    includeCompleted: false,
    now: Date.now(),
  };
  const statuses = await readWorkflowStatusList(ctx.cwd, query).catch(() => []);
  const lines = workflowMonitorWidgetLines(statuses, query.ownerSessionId);
  ctx.ui.setWidget(WORKFLOW_MONITOR_WIDGET, lines.length > 0 ? lines : undefined, { placement: "belowEditor" });
}
