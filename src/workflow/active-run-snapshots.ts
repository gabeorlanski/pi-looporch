/** Provides active run snapshots behavior. */
import { readActiveWorkflowRuns, removeActiveWorkflowRun, type ActiveWorkflowRunRecord } from "./active-runs.ts";
import { readWorkflowOutputManifest, readWorkflowSnapshot } from "./outputs.ts";
import type { WorkflowSnapshot } from "../runtime/types.ts";
import { isMissingFileError } from "../errors.ts";

export interface ActiveWorkflowSnapshot {
  runId: string;
  snapshot: WorkflowSnapshot;
}

/** Provides the readActiveWorkflowSnapshots function contract. */
export async function readActiveWorkflowSnapshots(cwd: string, ownerSessionId: string): Promise<ActiveWorkflowSnapshot[]> {
  const records = await readActiveWorkflowRuns(cwd, ownerSessionId);
  const snapshots = await Promise.all(records.map((record) => readActiveWorkflowSnapshot(cwd, record)));
  return snapshots.filter((snapshot): snapshot is ActiveWorkflowSnapshot => snapshot !== undefined);
}

async function readActiveWorkflowSnapshot(cwd: string, record: ActiveWorkflowRunRecord): Promise<ActiveWorkflowSnapshot | undefined> {
  if (record.ownerProcessId !== process.pid) {
    await removeActiveWorkflowRun(cwd, record.runId);
    return undefined;
  }
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
