/** Persists the live-session identity and resume metadata for workflow runs. */
import { open, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { isMissingFileError } from "../errors.ts";
import { writeJsonFileAtomic } from "./files.ts";
import { workflowProjectDirectory, workflowRunDirectory, workflowRunsDirectory } from "./run-storage.ts";

export interface RunRecord {
  runId: string;
  workflowName: string;
  cwd: string;
  input: unknown;
  ownerSessionId: string;
  ownerProcessId: number;
  startedAt: number;
  resumeCount: number;
  status: "running" | "done" | "error" | "aborted";
}

/** A running record with its canonical run-directory location. */
export interface ActiveWorkflowRunRecord extends Omit<RunRecord, "status"> {
  status: "running";
  outputsDir: string;
}

/** Reads canonical running records for this project, optionally restricted to one live session. */
export async function readActiveWorkflowRuns(cwd: string, ownerSessionId?: string): Promise<ActiveWorkflowRunRecord[]> {
  const sessionIds = ownerSessionId === undefined ? await workflowSessionIds(cwd) : [ownerSessionId];
  const records: ActiveWorkflowRunRecord[] = [];
  for (const sessionId of sessionIds) {
    records.push(...(await readActiveWorkflowRunsForSession(cwd, sessionId)));
  }
  return records;
}

/** Exclusively claims a run for one resume attempt until the returned release function is called. */
export async function claimRunRecord(
  cwd: string,
  ownerSessionId: string,
  runId: string,
): Promise<{ record: RunRecord; release: () => Promise<void> }> {
  const runDir = workflowRunDirectory(cwd, ownerSessionId, runId);
  const lockPath = path.join(runDir, "resume.lock");
  try {
    const lock = await open(lockPath, "wx");
    await lock.close();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(`Workflow run '${runId}' is already being resumed.`);
    }
    if (isMissingFileError(error)) throw new Error(`Workflow run '${runId}' was not found in the current session.`);
    throw error;
  }
  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    await rm(lockPath, { force: true });
  };
  try {
    const value = JSON.parse(await readFile(path.join(runDir, "run.json"), "utf8")) as unknown;
    if (!isRunRecord(value)) throw new Error(`Invalid workflow run record: ${runId}`);
    return { record: value, release };
  } catch (error) {
    await release();
    if (isMissingFileError(error)) throw new Error(`Workflow run '${runId}' was not found in the current session.`);
    throw error;
  }
}

/** Atomically writes a workflow run record beside its outputs and checkpoints. */
export async function writeRunRecord(outputsDir: string, record: RunRecord): Promise<void> {
  await writeJsonFileAtomic(path.join(outputsDir, "run.json"), record);
}

async function workflowSessionIds(cwd: string): Promise<string[]> {
  try {
    const entries = await readdir(workflowProjectDirectory(cwd), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => decodeURIComponent(entry.name));
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}

async function readActiveWorkflowRunsForSession(cwd: string, ownerSessionId: string): Promise<ActiveWorkflowRunRecord[]> {
  const runsDirectory = workflowRunsDirectory(cwd, ownerSessionId);
  try {
    const entries = await readdir(runsDirectory, { withFileTypes: true });
    const records: ActiveWorkflowRunRecord[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const record = await readActiveWorkflowRun(cwd, ownerSessionId, decodeURIComponent(entry.name), path.join(runsDirectory, entry.name));
      if (record !== undefined) records.push(record);
    }
    return records;
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}

async function readActiveWorkflowRun(
  cwd: string,
  ownerSessionId: string,
  runId: string,
  outputsDir: string,
): Promise<ActiveWorkflowRunRecord | undefined> {
  try {
    const value = JSON.parse(await readFile(path.join(outputsDir, "run.json"), "utf8")) as unknown;
    if (
      !isRunRecord(value) ||
      value.status !== "running" ||
      value.runId !== runId ||
      value.ownerSessionId !== ownerSessionId ||
      path.resolve(value.cwd) !== path.resolve(cwd)
    )
      return undefined;
    return { ...value, status: "running", outputsDir };
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

function isRunRecord(value: unknown): value is RunRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.runId === "string" &&
    typeof record.workflowName === "string" &&
    typeof record.cwd === "string" &&
    typeof record.ownerSessionId === "string" &&
    typeof record.ownerProcessId === "number" &&
    typeof record.startedAt === "number" &&
    typeof record.resumeCount === "number" &&
    (record.status === "running" || record.status === "done" || record.status === "error" || record.status === "aborted") &&
    "input" in record
  );
}
