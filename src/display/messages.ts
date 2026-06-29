export function completeMessage(workflowName: string, result: unknown): string {
  return `Workflow '${workflowName}' complete.\n\n${workflowResultPreview(result)}`;
}

export function workflowStringHandoffMessage(workflowName: string, handoff: string): string {
  return `Workflow '${workflowName}' returned this handoff from workflow():\n\n${handoff}`;
}

export function failureMessage(workflowName: string | undefined, error: unknown): string {
  const label = workflowName ? `Workflow '${workflowName}'` : "Workflow";
  return `${label} failed: ${error instanceof Error ? error.message : String(error)}`;
}

const MAX_VISIBLE_RESULT_CHARS = 6000;

export function workflowResultPreview(result: unknown, maxChars = MAX_VISIBLE_RESULT_CHARS): string {
  const text = typeof result === "string" ? result : result === undefined ? "undefined" : JSON.stringify(result, null, 2);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n… truncated. Full result is available in workflow session logs.`;
}
