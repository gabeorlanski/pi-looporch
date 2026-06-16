import type { WorkflowSnapshot } from "./workflow-runtime.ts";

const DEFAULT_WIDTH = 72;
const PHASE_WIDTH = 18;
const PROGRESS_WIDTH = 10;

interface WorkflowProgressRow {
  workflowName: string;
  phase: string;
  progress: string;
  tokens: string;
}

export function initialWorkflowProgressLines(workflowName = "workflow", width = DEFAULT_WIDTH): string[] {
  return workflowProgressTable({ workflowName, phase: "starting", progress: "0/0", tokens: "0 tokens" }, width);
}

export function initialWorkflowProgressStatusLine(): string {
  return workflowProgressSummary({ workflowName: "workflow", phase: "starting", progress: "0/0", tokens: "0 tokens" });
}

export function workflowProgressLines(snapshot: WorkflowSnapshot, width = DEFAULT_WIDTH): string[] {
  return workflowProgressTable(workflowProgressRowFromSnapshot(snapshot), width);
}

export function workflowProgressText(snapshot: WorkflowSnapshot, width = DEFAULT_WIDTH): string {
  return workflowProgressLines(snapshot, width).join("\n");
}

export function workflowProgressStatusLine(snapshot: WorkflowSnapshot): string {
  return workflowProgressSummary(workflowProgressRowFromSnapshot(snapshot));
}

export function formatTokenCount(tokenCount: number): string {
  if (tokenCount === 1) return "1 token";
  if (tokenCount < 1000) return `${String(tokenCount)} tokens`;
  if (tokenCount < 1_000_000) return `${trimFixed(tokenCount / 1000)}k tokens`;
  return `${trimFixed(tokenCount / 1_000_000)}M tokens`;
}

function workflowProgressRowFromSnapshot(snapshot: WorkflowSnapshot): WorkflowProgressRow {
  const phase = snapshot.phases.at(-1) ?? "starting";
  const fanOut = snapshot.fanOuts.at(-1);
  const total = fanOut?.total ?? snapshot.agents.length;
  const completed = fanOut ? fanOut.done + fanOut.error : snapshot.agents.filter((agent) => agent.status !== "running").length;
  return {
    workflowName: snapshot.workflowName,
    phase,
    progress: `${String(completed)}/${String(total)}`,
    tokens: formatTokenCount(totalTokenCount(snapshot)),
  };
}

function workflowProgressTable(row: WorkflowProgressRow, width: number): string[] {
  const safeWidth = Math.max(48, width);
  return [
    titleLine(`◆ workflow: ${row.workflowName}`, safeWidth),
    truncate(`  ${workflowProgressSummary(row)}`, safeWidth),
    "",
    workflowProgressTableHeader(safeWidth),
    `  ${"─".repeat(Math.max(0, safeWidth - 4))}`,
    workflowProgressTableRow(row, safeWidth),
  ];
}

function workflowProgressSummary(row: WorkflowProgressRow): string {
  return `Phase: ${row.phase}  Progress: ${row.progress}  Tokens: ${row.tokens}`;
}

function workflowProgressTableHeader(width: number): string {
  return truncate(`  ${"phase".padEnd(PHASE_WIDTH)}${"progress".padEnd(PROGRESS_WIDTH)}tokens`, width);
}

function workflowProgressTableRow(row: WorkflowProgressRow, width: number): string {
  return truncate(`  ${row.phase.padEnd(PHASE_WIDTH)}${row.progress.padEnd(PROGRESS_WIDTH)}${row.tokens}`, width);
}

function titleLine(title: string, width: number): string {
  const visibleTitle = truncate(title, Math.max(1, width - 5));
  const fill = Math.max(0, width - 4 - visibleTitle.length);
  return `─── ${visibleTitle} ${"─".repeat(fill)}`;
}

function truncate(value: string, width: number): string {
  return value.length <= width ? value : value.slice(0, Math.max(0, width - 1)) + "…";
}

function totalTokenCount(snapshot: WorkflowSnapshot): number {
  return snapshot.agents.reduce((total, agent) => total + agent.tokenCount, 0);
}

function trimFixed(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}
