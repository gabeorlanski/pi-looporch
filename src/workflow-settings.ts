import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface WorkflowSettings {
  maxParallelAgents: number;
}

export const DEFAULT_MAX_PARALLEL_AGENTS = 4;

export function projectSettingsPath(cwd: string): string {
  return path.join(cwd, ".pi", "settings.json");
}

export async function readProjectWorkflowSettings(cwd: string): Promise<WorkflowSettings> {
  let rawSettings: unknown;
  try {
    rawSettings = JSON.parse(await readFile(projectSettingsPath(cwd), "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { maxParallelAgents: DEFAULT_MAX_PARALLEL_AGENTS };
    throw error;
  }
  if (!isRecord(rawSettings)) throw new Error(".pi/settings.json must contain a JSON object");
  const workflow = rawSettings.workflow;
  if (workflow === undefined) return { maxParallelAgents: DEFAULT_MAX_PARALLEL_AGENTS };
  if (!isRecord(workflow)) throw new Error("workflow settings must be an object");
  return { maxParallelAgents: normalizeMaxParallelAgents(workflow.maxParallelAgents ?? DEFAULT_MAX_PARALLEL_AGENTS) };
}

export async function writeProjectWorkflowSettings(cwd: string, settings: WorkflowSettings): Promise<void> {
  const settingsPath = projectSettingsPath(cwd);
  let rawSettings: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as unknown;
    if (!isRecord(parsed)) throw new Error(".pi/settings.json must contain a JSON object");
    rawSettings = parsed;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }
  const workflow = isRecord(rawSettings.workflow) ? rawSettings.workflow : {};
  rawSettings.workflow = { ...workflow, maxParallelAgents: normalizeMaxParallelAgents(settings.maxParallelAgents) };
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(rawSettings, null, 2)}\n`, "utf8");
}

export function normalizeMaxParallelAgents(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    throw new Error("workflow.maxParallelAgents must be a positive integer");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
