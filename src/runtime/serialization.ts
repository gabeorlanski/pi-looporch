import type { WorkflowSnapshot } from "../runtime-types.ts";

export function cloneSnapshot(snapshot: WorkflowSnapshot): WorkflowSnapshot {
  return {
    ...snapshot,
    plannedPhases: snapshot.plannedPhases.map((phase) => ({ ...phase })),
    phases: [...snapshot.phases],
    logs: [...snapshot.logs],
    traces: snapshot.traces.map((trace) => ({ ...trace, ...(trace.value !== undefined ? { value: cloneSerializable(trace.value) } : {}) })),
    agents: snapshot.agents.map((agent) => ({ ...agent })),
    fanOuts: snapshot.fanOuts.map((fanOut) => ({ ...fanOut })),
    messages: snapshot.messages?.map((message) => ({ ...message })),
  };
}

export function cloneSerializable(value: unknown): unknown {
  if (value === undefined || value === null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

export function previewJson(value: unknown): string {
  return previewText(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

export function previewText(value: string): string {
  const maxLength = 4000;
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
