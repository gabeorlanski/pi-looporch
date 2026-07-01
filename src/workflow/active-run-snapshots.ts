import { readActiveWorkflowRuns, removeActiveWorkflowRun, type ActiveWorkflowRunRecord } from "./active-runs.ts";
import { readWorkflowOutputManifest, readWorkflowSnapshot } from "./outputs.ts";
import type { WorkflowSnapshot } from "../runtime/types.ts";

export interface ActiveWorkflowSnapshot {
  runId: string;
  snapshot: WorkflowSnapshot;
}

export interface ActiveWorkflowTerminalResult {
  runId: string;
  workflowName: string;
  outputsDir: string;
  resultPath?: string;
  error?: string;
  status: "done" | "error";
}

export async function readActiveWorkflowSnapshots(cwd: string, ownerSessionId: string): Promise<ActiveWorkflowSnapshot[]> {
  const records = await readActiveWorkflowRuns(cwd, ownerSessionId);
  const snapshots = await Promise.all(records.map((record) => readActiveWorkflowSnapshot(cwd, record)));
  return snapshots.filter((snapshot): snapshot is ActiveWorkflowSnapshot => snapshot !== undefined);
}

export async function readActiveWorkflowTerminalResults(cwd: string, ownerSessionId: string): Promise<ActiveWorkflowTerminalResult[]> {
  const records = await readActiveWorkflowRuns(cwd, ownerSessionId);
  const results = await Promise.all(records.map((record) => readActiveWorkflowTerminalResult(cwd, record)));
  return results.filter((result): result is ActiveWorkflowTerminalResult => result !== undefined);
}

async function readActiveWorkflowSnapshot(cwd: string, record: ActiveWorkflowRunRecord): Promise<ActiveWorkflowSnapshot | undefined> {
  try {
    const manifest = await readWorkflowOutputManifest(record.outputsDir);
    if (manifest.status !== "running") {
      await removeActiveWorkflowRun(cwd, record.runId);
      return undefined;
    }
    return { runId: record.runId, snapshot: await readWorkflowSnapshot(record.outputsDir) };
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    await removeActiveWorkflowRun(cwd, record.runId);
    return undefined;
  }
}

async function readActiveWorkflowTerminalResult(
  cwd: string,
  record: ActiveWorkflowRunRecord,
): Promise<ActiveWorkflowTerminalResult | undefined> {
  try {
    const manifest = await readWorkflowOutputManifest(record.outputsDir);
    if (manifest.status === "running") return undefined;
    await removeActiveWorkflowRun(cwd, record.runId);
    return {
      runId: record.runId,
      workflowName: record.workflowName,
      outputsDir: record.outputsDir,
      ...(manifest.resultPath ? { resultPath: manifest.resultPath } : {}),
      ...(manifest.error ? { error: manifest.error } : {}),
      status: manifest.status,
    };
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    await removeActiveWorkflowRun(cwd, record.runId);
    return undefined;
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
