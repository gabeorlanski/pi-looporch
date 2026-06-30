import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ActiveWorkflowRunRecord {
  runId: string;
  workflowName: string;
  outputsDir: string;
  startedAt: number;
}

export async function readActiveWorkflowRuns(cwd: string): Promise<ActiveWorkflowRunRecord[]> {
  try {
    const entries = await readdir(activeWorkflowRunsDir(cwd), { withFileTypes: true });
    const records = await Promise.all(
      entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => readActiveWorkflowRunFile(cwd, entry.name)),
    );
    return records.filter((record): record is ActiveWorkflowRunRecord => record !== undefined);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}

export async function registerActiveWorkflowRun(cwd: string, record: ActiveWorkflowRunRecord): Promise<void> {
  const filePath = activeWorkflowRunPath(cwd, record.runId);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${String(process.pid)}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

export async function removeActiveWorkflowRun(cwd: string, runId: string): Promise<void> {
  await rm(activeWorkflowRunPath(cwd, runId), { force: true });
}

function activeWorkflowRunsDir(cwd: string): string {
  return path.join(cwd, ".pi", "workflow-runs", "active");
}

function activeWorkflowRunPath(cwd: string, runId: string): string {
  return path.join(activeWorkflowRunsDir(cwd), `${encodeURIComponent(runId)}.json`);
}

async function readActiveWorkflowRunFile(cwd: string, fileName: string): Promise<ActiveWorkflowRunRecord | undefined> {
  const filePath = path.join(activeWorkflowRunsDir(cwd), fileName);
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return isActiveWorkflowRunRecord(parsed) ? parsed : undefined;
  } catch (error) {
    if (!isMissingFileError(error)) await rm(filePath, { force: true });
    return undefined;
  }
}

function isActiveWorkflowRunRecord(value: unknown): value is ActiveWorkflowRunRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.runId === "string" &&
    typeof candidate.workflowName === "string" &&
    typeof candidate.outputsDir === "string" &&
    typeof candidate.startedAt === "number"
  );
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
