/** Provides snapshot behavior. */
import type { WorkflowMetadata, WorkflowPhaseMetadata, WorkflowSnapshot } from "./types.ts";
import { cloneSerializable } from "./serialization.ts";

/** Provides the createInitialWorkflowSnapshot function contract. */
export function createInitialWorkflowSnapshot(workflowName: string, metadata: WorkflowMetadata, input: unknown): WorkflowSnapshot {
  return {
    workflowName,
    description: metadata.description,
    plannedPhases: cloneSerializable(metadata.phases) as WorkflowPhaseMetadata[],
    phases: [],
    traces: [],
    agents: [],
    llms: [],
    fanOuts: [],
    messages: [],
    status: "running",
    input: cloneSerializable(input),
  };
}
