/** Provides serialization behavior. */
import type { WorkflowSnapshot } from "./types.ts";

/** Provides the cloneSnapshot function contract. */
export function cloneSnapshot(snapshot: WorkflowSnapshot): WorkflowSnapshot {
  return {
    ...snapshot,
    plannedPhases: snapshot.plannedPhases.map((phase) => ({ ...phase })),
    phases: [...snapshot.phases],
    traces: snapshot.traces.map((trace) => ({ ...trace, ...(trace.value !== undefined ? { value: cloneSerializable(trace.value) } : {}) })),
    agents: snapshot.agents.map((agent) => ({ ...agent })),
    fanOuts: snapshot.fanOuts.map((fanOut) => ({ ...fanOut })),
    messages: snapshot.messages.map((message) => ({ ...message })),
  };
}

/** Provides the cloneSerializable function contract. */
export function cloneSerializable(value: unknown): unknown {
  if (value === undefined || value === null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value)) as unknown;
}
