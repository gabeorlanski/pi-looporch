/** Provides active runs behavior. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isMissingFileError } from "../errors.ts";
import { activeWorkflowRunsDirectory, storageComponent, workflowProjectDirectory } from "./run-storage.ts";

export interface ActiveWorkflowRunRecord {
  runId: string;
  workflowName: string;
  outputsDir: string;
  startedAt: number;
  ownerSessionId: string;
  ownerProcessId: number;
}

export type NewActiveWorkflowRunRecord = Omit<ActiveWorkflowRunRecord, "ownerProcessId"> & { ownerProcessId?: number };

/** Provides the readActiveWorkflowRuns function contract. */
export async function readActiveWorkflowRuns(cwd: string, ownerSessionId?: string): Promise<ActiveWorkflowRunRecord[]> {
  const sessionIds = ownerSessionId === undefined ? await activeWorkflowSessionIds(cwd) : [ownerSessionId];
  const records = (
    await Promise.all(
      sessionIds.map(async (sessionId) => {
        try {
          const entries = await readdir(activeWorkflowRunsDirectory(cwd, sessionId), { withFileTypes: true });
          return await Promise.all(
            entries
              .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
              .map((entry) => readActiveWorkflowRunFile(cwd, sessionId, entry.name)),
          );
        } catch (error) {
          if (isMissingFileError(error)) return [];
          throw error;
        }
      }),
    )
  ).flat();
  return records.filter(
    (record): record is ActiveWorkflowRunRecord =>
      record !== undefined && (ownerSessionId === undefined || record.ownerSessionId === ownerSessionId),
  );
}

/** Provides the registerActiveWorkflowRun function contract. */
export async function registerActiveWorkflowRun(cwd: string, record: NewActiveWorkflowRunRecord): Promise<void> {
  const filePath = activeWorkflowRunPath(cwd, record.ownerSessionId, record.runId);
  const storedRecord: ActiveWorkflowRunRecord = { ...record, ownerProcessId: record.ownerProcessId ?? process.pid };
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${String(process.pid)}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(storedRecord, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

/** Provides the removeActiveWorkflowRun function contract. */
export async function removeActiveWorkflowRun(cwd: string, runId: string, ownerSessionId?: string): Promise<void> {
  if (ownerSessionId !== undefined) {
    await rm(activeWorkflowRunPath(cwd, ownerSessionId, runId), { force: true });
    return;
  }
  const sessionIds = await activeWorkflowSessionIds(cwd);
  await Promise.all(sessionIds.map((sessionId) => rm(activeWorkflowRunPath(cwd, sessionId, runId), { force: true })));
}

async function activeWorkflowSessionIds(cwd: string): Promise<string[]> {
  try {
    const entries = await readdir(workflowProjectDirectory(cwd), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => decodeURIComponent(entry.name));
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}

function activeWorkflowRunPath(cwd: string, ownerSessionId: string, runId: string): string {
  return path.join(activeWorkflowRunsDirectory(cwd, ownerSessionId), `${storageComponent(runId)}.json`);
}

async function readActiveWorkflowRunFile(
  cwd: string,
  ownerSessionId: string,
  fileName: string,
): Promise<ActiveWorkflowRunRecord | undefined> {
  const filePath = path.join(activeWorkflowRunsDirectory(cwd, ownerSessionId), fileName);
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (isActiveWorkflowRunRecord(parsed)) return parsed;
    await rm(filePath, { force: true });
    return undefined;
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
    typeof candidate.startedAt === "number" &&
    typeof candidate.ownerSessionId === "string" &&
    typeof candidate.ownerProcessId === "number"
  );
}
