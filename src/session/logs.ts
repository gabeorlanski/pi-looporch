/** Provides session logs behavior. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { WorkflowSnapshot } from "../runtime/types.ts";
import { errorMessage } from "../errors.ts";

export interface WorkflowSessionSummaryOptions {
  cwd: string;
  parentId: string;
  snapshot: WorkflowSnapshot;
  resultPath?: string;
  error?: unknown;
  sessionsRoot?: string;
}

/** Provides the workflowAgentSessionLogParentDirectory function contract. */
export function workflowAgentSessionLogParentDirectory(
  cwd: string,
  parentId: string,
  sessionsRoot = path.join(getAgentDir(), "sessions"),
): string {
  return path.join(sessionsRoot, workflowProjectKey(cwd), parentId);
}

/** Provides the workflowAgentSessionLogDirectory function contract. */
export function workflowAgentSessionLogDirectory(
  cwd: string,
  parentId: string,
  agentKey: string,
  sessionsRoot = path.join(getAgentDir(), "sessions"),
): string {
  return path.join(workflowAgentSessionLogParentDirectory(cwd, parentId, sessionsRoot), agentKey);
}

/** Provides the writeWorkflowSessionSummary function contract. */
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
    status: options.snapshot.status,
    plannedPhases: options.snapshot.plannedPhases,
    phases: options.snapshot.phases.map((title, index) => ({ index: index + 1, title })),
    traces: options.snapshot.traces,
    messages: options.snapshot.messages,
    agents: options.snapshot.agents.map((agent) => {
      const summaryAgent = { ...agent };
      delete summaryAgent.message;
      return summaryAgent;
    }),
    llms: options.snapshot.llms,
    fanOuts: options.snapshot.fanOuts,
    ...(options.resultPath !== undefined ? { resultPath: options.resultPath } : {}),
    ...(options.error !== undefined ? { error: errorMessage(options.error) } : {}),
  };
}

function workflowProjectKey(cwd: string): string {
  return `--${path
    .resolve(cwd)
    .replace(/^[/\\]/, "")
    .replace(/[/\\:]/g, "-")}--`;
}
