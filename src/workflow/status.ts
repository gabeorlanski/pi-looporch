import path from "node:path";
import { readActiveWorkflowRuns, type ActiveWorkflowRunRecord } from "./active-runs.ts";
import { readWorkflowOutputManifest, readWorkflowSnapshot } from "./outputs.ts";
import type { WorkflowAgentSnapshot, WorkflowFanOutSnapshot, WorkflowSnapshot } from "../runtime/types.ts";
import { errorMessage } from "../errors.ts";

export type WorkflowStatusScope = "project" | "current-session";

export interface WorkflowStatusQuery {
  scope: WorkflowStatusScope;
  ownerSessionId: string;
  ref: string;
  includeCompleted: boolean;
  now: number;
}

export interface WorkflowAgentStatus {
  id: number;
  label: string;
  phase?: string;
  model?: string;
  reasoning?: string;
  durationSeconds: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  steps: number;
  message?: string;
}

export interface WorkflowFanOutStatus {
  id: number;
  label: string;
  total: number;
  done: number;
  running: number;
  error: number;
}

export interface WorkflowAgentTotals {
  total: number;
  done: number;
  running: number;
  error: number;
}

export interface WorkflowRunStatus {
  runId: string;
  workflowName: string;
  status: "running" | "done" | "error";
  scope: WorkflowStatusScope;
  ownerSessionId: string;
  outputsDir: string;
  resultPath: string | null;
  startedAt: number;
  elapsedSeconds: number;
  currentPhase: string;
  snapshotAvailable: boolean;
  agents: WorkflowAgentTotals;
  fanouts: WorkflowFanOutStatus[];
  activeAgents: WorkflowAgentStatus[];
  errors: string[];
}

export type SelectedWorkflowStatus =
  | WorkflowRunStatus
  | {
      status: "none";
      scope: WorkflowStatusScope;
      ref: string;
      workflowCount: number;
      errors: string[];
    };

export async function readWorkflowStatusList(cwd: string, query: WorkflowStatusQuery): Promise<WorkflowRunStatus[]> {
  const records = await readActiveWorkflowRuns(cwd, query.scope === "current-session" ? query.ownerSessionId : undefined);
  const statuses = await Promise.all(records.map((record) => readWorkflowRunStatus(record, query)));
  return statuses
    .filter((status): status is WorkflowRunStatus => status !== undefined)
    .filter((status) => query.includeCompleted || status.status === "running")
    .sort((left, right) => right.startedAt - left.startedAt);
}

export async function readSelectedWorkflowStatus(cwd: string, query: WorkflowStatusQuery): Promise<SelectedWorkflowStatus> {
  return selectWorkflowStatus(cwd, await readWorkflowStatusList(cwd, query), query);
}

export function selectWorkflowStatus(cwd: string, statuses: WorkflowRunStatus[], query: WorkflowStatusQuery): SelectedWorkflowStatus {
  const selected = query.ref === "latest" ? statuses[0] : statuses.find((status) => matchesWorkflowRef(cwd, status, query.ref));
  return (
    selected ?? {
      status: "none",
      scope: query.scope,
      ref: query.ref,
      workflowCount: statuses.length,
      errors: [],
    }
  );
}

async function readWorkflowRunStatus(record: ActiveWorkflowRunRecord, query: WorkflowStatusQuery): Promise<WorkflowRunStatus | undefined> {
  const manifestResult = await readManifestStatus(record.outputsDir);
  if (!manifestResult) return undefined;
  if (manifestResult.kind === "error")
    return degradedWorkflowRunStatus(record, query, "running", null, "manifest unavailable", manifestResult.error);
  if (manifestResult.manifest.status !== "running" && !query.includeCompleted) return undefined;

  const snapshotResult = await readSnapshotStatus(record.outputsDir);
  if (snapshotResult.kind === "ok") {
    return workflowRunStatusFromSnapshot(
      record,
      query,
      manifestResult.manifest.status,
      manifestResult.manifest.resultPath ?? null,
      manifestResult.manifest.error,
      snapshotResult.snapshot,
    );
  }
  return degradedWorkflowRunStatus(
    record,
    query,
    manifestResult.manifest.status,
    manifestResult.manifest.resultPath ?? null,
    "snapshot unavailable",
    snapshotResult.error,
  );
}

async function readManifestStatus(
  outputsDir: string,
): Promise<
  { kind: "ok"; manifest: Awaited<ReturnType<typeof readWorkflowOutputManifest>> } | { kind: "error"; error: string } | undefined
> {
  try {
    return { kind: "ok", manifest: await readWorkflowOutputManifest(outputsDir) };
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    return { kind: "error", error: errorMessage(error) };
  }
}

async function readSnapshotStatus(
  outputsDir: string,
): Promise<{ kind: "ok"; snapshot: WorkflowSnapshot } | { kind: "error"; error: string }> {
  try {
    return { kind: "ok", snapshot: await readWorkflowSnapshot(outputsDir) };
  } catch (error) {
    return { kind: "error", error: errorMessage(error) };
  }
}

function workflowRunStatusFromSnapshot(
  record: ActiveWorkflowRunRecord,
  query: WorkflowStatusQuery,
  manifestStatus: "running" | "done" | "error",
  resultPath: string | null,
  manifestError: string | undefined,
  snapshot: WorkflowSnapshot,
): WorkflowRunStatus {
  const errors = [
    manifestError,
    ...snapshot.agents.filter((agent) => agent.status === "error").map((agent) => `${agent.label}: ${agent.error ?? "agent failed"}`),
  ].filter((error): error is string => error !== undefined);
  return {
    runId: record.runId,
    workflowName: record.workflowName,
    status: manifestStatus,
    scope: query.scope,
    ownerSessionId: record.ownerSessionId,
    outputsDir: record.outputsDir,
    resultPath,
    startedAt: record.startedAt,
    elapsedSeconds: elapsedSeconds(record.startedAt, query.now),
    currentPhase: currentPhase(snapshot, manifestStatus),
    snapshotAvailable: true,
    agents: agentTotals(snapshot.agents),
    fanouts: snapshot.fanOuts.map(fanoutStatus),
    activeAgents: snapshot.agents.filter((agent) => agent.status === "running").map((agent) => agentStatus(agent, query.now)),
    errors,
  };
}

function degradedWorkflowRunStatus(
  record: ActiveWorkflowRunRecord,
  query: WorkflowStatusQuery,
  status: "running" | "done" | "error",
  resultPath: string | null,
  message: string,
  error: string,
): WorkflowRunStatus {
  return {
    runId: record.runId,
    workflowName: record.workflowName,
    status,
    scope: query.scope,
    ownerSessionId: record.ownerSessionId,
    outputsDir: record.outputsDir,
    resultPath,
    startedAt: record.startedAt,
    elapsedSeconds: elapsedSeconds(record.startedAt, query.now),
    currentPhase: message,
    snapshotAvailable: false,
    agents: { total: 0, done: 0, running: 0, error: 0 },
    fanouts: [],
    activeAgents: [],
    errors: [error],
  };
}

function matchesWorkflowRef(cwd: string, status: WorkflowRunStatus, ref: string): boolean {
  const resolvedRef = path.resolve(cwd, ref);
  return (
    status.workflowName.startsWith(ref) ||
    status.runId.startsWith(ref) ||
    status.outputsDir === ref ||
    path.resolve(cwd, status.outputsDir) === resolvedRef
  );
}

function currentPhase(snapshot: WorkflowSnapshot, status: "running" | "done" | "error"): string {
  return snapshot.phases.at(-1) ?? (status === "running" ? "running" : status);
}

function agentTotals(agents: WorkflowAgentSnapshot[]): WorkflowAgentTotals {
  return {
    total: agents.length,
    done: agents.filter((agent) => agent.status !== "running").length,
    running: agents.filter((agent) => agent.status === "running").length,
    error: agents.filter((agent) => agent.status === "error").length,
  };
}

function fanoutStatus(fanout: WorkflowFanOutSnapshot): WorkflowFanOutStatus {
  return {
    id: fanout.id,
    label: fanout.label,
    total: fanout.total,
    done: fanout.done,
    running: fanout.running,
    error: fanout.error,
  };
}

function agentStatus(agent: WorkflowAgentSnapshot, now: number): WorkflowAgentStatus {
  return {
    id: agent.id,
    label: agent.label,
    ...(agent.phase ? { phase: agent.phase } : {}),
    ...(agent.model ? { model: agent.model } : {}),
    ...(agent.reasoning ? { reasoning: agent.reasoning } : {}),
    durationSeconds: elapsedSeconds(agent.startedAt, agent.endedAt ?? now),
    inputTokens: agent.inputTokenCount,
    outputTokens: agent.outputTokenCount,
    toolCalls: agent.toolCallCount,
    steps: agent.stepCount,
    ...(agent.message ? { message: agent.message } : {}),
  };
}

function elapsedSeconds(startedAt: number, now: number): number {
  return Math.max(0, Math.round((now - startedAt) / 1000));
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
