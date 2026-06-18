import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { WorkflowSnapshot } from "./runtime.ts";

export interface WorkflowSessionSummaryOptions {
  cwd: string;
  parentId: string;
  snapshot: WorkflowSnapshot;
  result?: unknown;
  error?: unknown;
  sessionsRoot?: string;
}

export function workflowAgentSessionLogParentDirectory(
  cwd: string,
  parentId: string,
  sessionsRoot = path.join(getAgentDir(), "sessions"),
): string {
  return path.join(sessionsRoot, workflowProjectKey(cwd), parentId);
}

export function workflowAgentSessionLogDirectory(
  cwd: string,
  parentId: string,
  agentKey: string,
  sessionsRoot = path.join(getAgentDir(), "sessions"),
): string {
  return path.join(workflowAgentSessionLogParentDirectory(cwd, parentId, sessionsRoot), agentKey);
}

export async function writeWorkflowSessionSummary(options: WorkflowSessionSummaryOptions): Promise<string> {
  const runDir = workflowAgentSessionLogParentDirectory(options.cwd, options.parentId, options.sessionsRoot);
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "workflow-summary.json"), `${JSON.stringify(workflowSessionSummary(options), null, 2)}\n`, "utf8");
  return runDir;
}

function workflowSessionSummary(options: WorkflowSessionSummaryOptions): Record<string, unknown> {
  return {
    workflowName: options.snapshot.workflowName,
    description: options.snapshot.description,
    plannedPhases: options.snapshot.plannedPhases,
    phases: options.snapshot.phases.map((title, index) => ({ index: index + 1, title })),
    traces: options.snapshot.traces,
    agents: options.snapshot.agents.map((agent) => ({
      id: agent.id,
      label: agent.label,
      phaseIndex: agent.phaseIndex,
      phase: agent.phase,
      fanOutId: agent.fanOutId,
      status: agent.status,
      sessionDir: agent.sessionDir,
      sessionFile: agent.sessionFile,
      eventsFile: agent.eventsFile,
    })),
    fanOuts: options.snapshot.fanOuts,
    ...(options.result !== undefined ? { result: options.result } : {}),
    ...(options.error !== undefined ? { error: errorMessage(options.error) } : {}),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") return String(error);
  if (typeof error === "symbol") return error.description ?? "symbol";
  return JSON.stringify(error);
}

function workflowProjectKey(cwd: string): string {
  return `--${path
    .resolve(cwd)
    .replace(/^[/\\]/, "")
    .replace(/[/\\:]/g, "-")}--`;
}
