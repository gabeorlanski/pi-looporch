/** Provides run id behavior. */
import { randomUUID } from "node:crypto";

/** Provides the createWorkflowRunId function contract. */
export function createWorkflowRunId(workflowName: string, startedAt = new Date()): string {
  return `${startedAt.toISOString().replace(/[:.]/g, "-")}-${workflowName}-${randomUUID().slice(0, 8)}`;
}
