export function workflowNaturalLanguageRequestMessage(request: string, availableWorkflowNames: string[]): string {
  return [
    "Handle this workflow request in the current session.",
    "If an existing workflow fits, call run_workflow with its name and JSON input.",
    "If a new reusable workflow is needed, call propose_workflow with name, summary, steps, willRun, and complete workflow.js source.",
    "The workflow.js source must not import modules or use require(). Use only workflow globals: agent, parallel, pipeline, phase, log, args, cwd, budget, readText, and readJson.",
    `Available workflows: ${availableWorkflowNames.length ? availableWorkflowNames.join(", ") : "none"}`,
    "Request:",
    request,
  ].join("\n\n");
}
