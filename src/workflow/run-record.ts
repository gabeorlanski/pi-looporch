/** Persists the live-session identity and resume metadata for workflow runs. */
import { open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { isMissingFileError } from "../errors.ts";
import { writeJsonFileAtomic } from "./files.ts";
import { workflowRunDirectory } from "./run-storage.ts";

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
