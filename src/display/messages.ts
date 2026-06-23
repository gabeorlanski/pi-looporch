import type { WorkflowAgentSnapshot, WorkflowFanOutSnapshot, WorkflowSnapshot } from "../runtime.ts";

export function startMessage(workflowName: string): string {
  return `Starting workflow '${workflowName}'...`;
}

export function completeMessage(workflowName: string, result: unknown): string {
  return `Workflow '${workflowName}' complete.\n\n${workflowResultPreview(result)}`;
}

export function failureMessage(workflowName: string | undefined, error: unknown): string {
  const label = workflowName ? `Workflow '${workflowName}'` : "Workflow";
  return `${label} failed: ${error instanceof Error ? error.message : String(error)}`;
}

export function snapshotMessages(previous: WorkflowSnapshot | undefined, next: WorkflowSnapshot): string[] {
  return [
    ...newPhaseMessages(previous, next),
    ...newLogMessages(previous, next),
    ...changedFanOutMessages(previous, next),
    ...changedAgentMessages(previous, next),
  ];
}

function newPhaseMessages(previous: WorkflowSnapshot | undefined, next: WorkflowSnapshot): string[] {
  const previousCount = previous?.phases.length ?? 0;
  return next.phases.slice(previousCount).map((phase) => `Workflow ${next.workflowName} phase: ${phase}`);
}

function newLogMessages(previous: WorkflowSnapshot | undefined, next: WorkflowSnapshot): string[] {
  const previousCount = previous?.logs.length ?? 0;
  return next.logs.slice(previousCount).map((log) => `Workflow ${next.workflowName} log: ${log}`);
}

function changedFanOutMessages(previous: WorkflowSnapshot | undefined, next: WorkflowSnapshot): string[] {
  return next.fanOuts.flatMap((fanOut) => {
    const before = previous?.fanOuts.find((candidate) => candidate.id === fanOut.id);
    return fanOutChanged(before, fanOut)
      ? [
          `Workflow ${next.workflowName} fan-out ${fanOut.label}: ${String(fanOut.done)}/${String(fanOut.total)} done, ${String(fanOut.running)} running, ${String(fanOut.error)} errors`,
        ]
      : [];
  });
}

function changedAgentMessages(previous: WorkflowSnapshot | undefined, next: WorkflowSnapshot): string[] {
  return next.agents.flatMap((agent) => {
    const before = previous?.agents.find((candidate) => candidate.id === agent.id);
    return agentChanged(before, agent)
      ? [`Workflow ${next.workflowName} agent ${agent.label}: ${agent.status}${agent.message ? ` · ${agent.message}` : ""}`]
      : [];
  });
}

function fanOutChanged(previous: WorkflowFanOutSnapshot | undefined, next: WorkflowFanOutSnapshot): boolean {
  return previous?.running !== next.running || previous.done !== next.done || previous.error !== next.error;
}

function agentChanged(previous: WorkflowAgentSnapshot | undefined, next: WorkflowAgentSnapshot): boolean {
  return previous?.status !== next.status || previous.message !== next.message;
}

const MAX_VISIBLE_RESULT_CHARS = 6000;

export function workflowResultPreview(result: unknown, maxChars = MAX_VISIBLE_RESULT_CHARS): string {
  const text = typeof result === "string" ? result : result === undefined ? "undefined" : JSON.stringify(result, null, 2);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n… truncated. Full result is available in workflow session logs.`;
}
