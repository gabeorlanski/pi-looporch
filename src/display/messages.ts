import { errorMessage } from "../errors.ts";

export function completeMessage(workflowName: string): string {
  return `Workflow '${workflowName}' complete.`;
}

export function failureMessage(workflowName: string | undefined, error: unknown): string {
  const label = workflowName ? `Workflow '${workflowName}'` : "Workflow";
  return `${label} failed: ${errorMessage(error)}`;
}
