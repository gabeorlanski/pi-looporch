/** Provides workflow status behavior. */
import type { SelectedWorkflowStatus, WorkflowRunStatus } from "../workflow/status.ts";
import { fmtDuration, fmtTokens, glyph } from "./workflow-tui-format.ts";

/** Provides the renderWorkflowStatus function contract. */
export function renderWorkflowStatus(status: SelectedWorkflowStatus): string {
  if (status.status === "none") {
    const scopeLabel = status.scope === "project" ? "project" : "current session";
    return status.workflowCount === 0
      ? `No active workflows in this ${scopeLabel}.`
      : `No workflow matching '${status.ref}' in this ${scopeLabel}.`;
  }

  const lines = [
    `${status.workflowName} ${status.status} · phase: ${status.currentPhase} · ${String(status.agents.done)}/${String(
      status.agents.total,
    )} agents done · ${fmtDuration(status.elapsedSeconds)}`,
  ];
  if (!status.snapshotAvailable) lines.push("", "Snapshot unavailable.");
  const visibleFanouts = [...status.fanouts].sort((left, right) => right.running - left.running);
  if (visibleFanouts.length > 0) {
    lines.push("", "Fanouts:");
    lines.push(
      ...visibleFanouts.map(
        (fanout) =>
          `- ${fanout.label}: ${String(fanout.done)}/${String(fanout.total)} done, ${String(fanout.running)} running, ${String(
            fanout.error,
          )} errors`,
      ),
    );
  }
  if (status.activeAgents.length > 0) {
    lines.push("", "Active agents:");
    lines.push(
      ...status.activeAgents.slice(0, 8).map((agent) => {
        const tokens = agent.inputTokens + agent.outputTokens;
        const parts = [
          `#${String(agent.id)} ${agent.label}`,
          fmtDuration(agent.durationSeconds),
          `${String(agent.steps)} steps`,
          `${fmtTokens(tokens)} tokens`,
        ];
        return `- ${parts.join(" · ")}`;
      }),
    );
  }
  if (status.errors.length > 0) {
    lines.push("", "Errors:");
    lines.push(...status.errors.map((error) => `- ${error}`));
  }
  lines.push("", "Outputs:", `- outputsDir: ${status.outputsDir}`, `- finalResultPath: ${status.resultPath ?? "not written yet"}`);
  return lines.join("\n");
}

/** Provides the renderWorkflowStatusJson function contract. */
export function renderWorkflowStatusJson(status: SelectedWorkflowStatus): string {
  return `${JSON.stringify(status, null, 2)}\n`;
}

/** Provides the renderWorkflowStatusList function contract. */
export function renderWorkflowStatusList(statuses: WorkflowRunStatus[]): string {
  if (statuses.length === 0) return "No active workflows in this project.";
  return statuses.map(renderWorkflowStatus).join("\n\n");
}

/** Provides the workflowMonitorWidgetLines function contract. */
export function workflowMonitorWidgetLines(statuses: WorkflowRunStatus[], ownerSessionId: string): string[] {
  const active = statuses.filter((status) => status.status === "running" && status.ownerSessionId !== ownerSessionId);
  if (active.length === 0) return [];
  if (active.length === 1) return singleWorkflowWidgetLines(active[0]);
  return [
    `${glyph.spinner[0]} ${String(active.length)} workflows active in this project`,
    ...active.map((status) => {
      return `  ${status.workflowName} · other session · ${status.currentPhase} · ${String(status.agents.done)}/${String(
        status.agents.total,
      )} agents`;
    }),
  ];
}

function singleWorkflowWidgetLines(status: WorkflowRunStatus): string[] {
  const lines = [
    `${glyph.spinner[0]} ${status.workflowName} · other session · ${status.currentPhase} · ${String(status.agents.done)}/${String(
      status.agents.total,
    )} agents · ${fmtDuration(status.elapsedSeconds)}`,
  ];
  const fanouts = [...status.fanouts].sort((left, right) => right.running - left.running);
  if (fanouts.length > 0) {
    const activeFanout = fanouts[0];
    lines.push(
      `  ${activeFanout.label}: ${String(activeFanout.done)}/${String(activeFanout.total)} done · ${String(
        activeFanout.running,
      )} running · ${String(activeFanout.error)} errors`,
    );
  }
  return lines;
}
