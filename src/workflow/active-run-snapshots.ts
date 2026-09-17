/** Provides active run snapshots behavior. */
import { isMissingFileError } from "../errors.ts";
import { readActiveWorkflowRuns, type ActiveWorkflowRunRecord } from "./run-record.ts";
import { readWorkflowSnapshot } from "./outputs.ts";
import type { WorkflowSnapshot } from "../runtime/types.ts";

export interface ActiveWorkflowSnapshot {
  runId: string;
  snapshot: WorkflowSnapshot;
}

/** Provides the readActiveWorkflowSnapshots function contract. */
export async function readActiveWorkflowSnapshots(cwd: string, ownerSessionId: string): Promise<ActiveWorkflowSnapshot[]> {
  const records = await readActiveWorkflowRuns(cwd, ownerSessionId);
  const snapshots: ActiveWorkflowSnapshot[] = [];
  for (const record of records) {
    const snapshot = await readActiveWorkflowSnapshot(record);
    if (snapshot !== undefined) snapshots.push(snapshot);
  }
  return snapshots;
}

async function readActiveWorkflowSnapshot(record: ActiveWorkflowRunRecord): Promise<ActiveWorkflowSnapshot | undefined> {
  if (record.ownerProcessId !== process.pid) {
    return undefined;
  }
  try {
    return { runId: record.runId, snapshot: await readWorkflowSnapshot(record.outputsDir) };
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}
