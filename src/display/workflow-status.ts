import type { SelectedWorkflowStatus, WorkflowRunStatus } from "../workflow/status.ts";
import { fmtDuration, fmtTokens, glyph } from "./workflow-tui-format.ts";

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

export function renderWorkflowStatusJson(status: SelectedWorkflowStatus): string {
  return `${JSON.stringify(status, null, 2)}\n`;
}

export function renderWorkflowStatusList(statuses: WorkflowRunStatus[]): string {
  if (statuses.length === 0) return "No active workflows in this project.";
  return statuses.map((status) => renderWorkflowStatus(status)).join("\n\n");
}

export function workflowMonitorWidgetLines(statuses: WorkflowRunStatus[], ownerSessionId: string): string[] {
  const active = statuses.filter((status) => status.status === "running");
  if (active.length === 0) return [];
  if (active.length === 1) return singleWorkflowWidgetLines(active[0], ownerSessionId);
  return [
    `${glyph.spinner[0]} ${String(active.length)} workflows active in this project`,
    ...active.map((status) => {
      const session = status.ownerSessionId === ownerSessionId ? "" : " · other session";
      return `  ${status.workflowName}${session} · ${status.currentPhase} · ${String(status.agents.done)}/${String(
        status.agents.total,
      )} agents`;
    }),
  ];
}

function singleWorkflowWidgetLines(status: WorkflowRunStatus, ownerSessionId: string): string[] {
  const session = status.ownerSessionId === ownerSessionId ? "" : " · other session";
  const lines = [
    `${glyph.spinner[0]} ${status.workflowName}${session} · ${status.currentPhase} · ${String(status.agents.done)}/${String(
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
