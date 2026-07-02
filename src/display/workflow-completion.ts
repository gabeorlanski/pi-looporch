import { completeMessage } from "./messages.ts";

const VISIBLE_RESULT_LIMIT = 12_000;
const PROMPT_RESULT_LIMIT = 16_000;

export interface WorkflowCompletionInfo {
  workflowName: string;
  result: unknown;
  outputsDir?: string;
  resultPath?: string;
  sessionLogDir?: string;
}

export function workflowCompletionMessage(info: WorkflowCompletionInfo): string {
  return [
    completeMessage(info.workflowName),
    "",
    renderWorkflowResultSection(info.result, VISIBLE_RESULT_LIMIT, info.resultPath),
    "",
    "Outputs:",
    ...workflowCompletionLocations(info),
  ].join("\n");
}

export function workflowCompletionReviewPrompt(info: WorkflowCompletionInfo): string {
  return [
    `Automated workflow completion handoff: workflow '${info.workflowName}' completed.`,
    "",
    "Review and summarize the workflow result for the user. If the result is a report, surface the report directly and add only the brief orientation needed to make it useful. If it is structured data, summarize the key outcomes, decisions, errors, and next actions. Read the output paths only if the preview is insufficient.",
    "",
    renderWorkflowResultSection(info.result, PROMPT_RESULT_LIMIT, info.resultPath),
    "",
    "Paths:",
    ...workflowCompletionLocations(info),
  ].join("\n");
}

export function workflowCompletionNotification(info: WorkflowCompletionInfo): string {
  return workflowCompletionMessage(info);
}

function workflowCompletionLocations(info: WorkflowCompletionInfo): string[] {
  return [
    info.resultPath ? `- Workflow result: ${info.resultPath}` : undefined,
    info.outputsDir ? `- Workflow outputs: ${info.outputsDir}` : undefined,
    info.sessionLogDir ? `- Workflow session logs: ${info.sessionLogDir}` : undefined,
  ].filter((line): line is string => line !== undefined);
}

function renderWorkflowResultSection(result: unknown, maxLength: number, resultPath: string | undefined): string {
  const rendered = renderWorkflowResult(result);
  const body = truncateResult(rendered.body, maxLength, resultPath);
  if (rendered.format === "markdown") return `${rendered.heading}:\n\n${body}`;
  return `${rendered.heading}:\n\n\`\`\`${rendered.format}\n${body}\n\`\`\``;
}

function renderWorkflowResult(result: unknown): { heading: string; body: string; format: "json" | "markdown" } {
  if (typeof result === "string") return { heading: "Result", body: result, format: "markdown" };
  const report = reportResult(result);
  if (report) return { heading: "Report", body: report, format: "markdown" };
  if (result === undefined) return { heading: "Result", body: "undefined", format: "json" };
  return { heading: "Result", body: JSON.stringify(result, null, 2), format: "json" };
}

function reportResult(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const record = result as Record<string, unknown>;
  if (typeof record.report !== "string" || !record.report.trim()) return undefined;
  const additionalData = { ...record };
  delete additionalData.report;
  const additionalKeys = Object.keys(additionalData);
  if (additionalKeys.length === 0) return record.report;
  return `${record.report}\n\nAdditional data:\n\n\`\`\`json\n${JSON.stringify(additionalData, null, 2)}\n\`\`\``;
}

function truncateResult(value: string, maxLength: number, resultPath: string | undefined): string {
  if (value.length <= maxLength) return value;
  const suffix = resultPath ? `\n\n[truncated; full result: ${resultPath}]` : "\n\n[truncated]";
  return `${value.slice(0, Math.max(0, maxLength - suffix.length))}${suffix}`;
}
