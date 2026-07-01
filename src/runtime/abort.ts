export function throwIfWorkflowAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("Workflow aborted");
}
