/** Provides the canonical model-call view of workflow snapshots. */
import type { WorkflowSnapshot, WorkflowSnapshotCall } from "./types.ts";

/** Returns every recorded model call with its runtime kind. */
export function workflowCalls(snapshot: Pick<WorkflowSnapshot, "agents" | "llms">): readonly WorkflowSnapshotCall[] {
  return [
    ...snapshot.agents.map((agent) => ({ ...agent, kind: "agent" as const })),
    ...snapshot.llms.map((llm) => ({ ...llm, kind: "llm" as const })),
  ];
}
