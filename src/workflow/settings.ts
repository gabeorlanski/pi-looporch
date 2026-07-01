import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { PROJECT_CONFIG_DIR } from "./config-dir.ts";

export interface WorkflowSettings {
  workflowDirs: string[];
  maxParallelAgents: number;
  childAgentExtensions: string[];
}

export interface WorkflowSettingsPatch {
  workflowDirs?: string[];
  maxParallelAgents?: number;
  childAgentExtensions?: string[];
}

export const DEFAULT_MAX_PARALLEL_AGENTS = 4;
const DEFAULT_CHILD_AGENT_EXTENSIONS: string[] = [];
const DEFAULT_WORKFLOW_DIRS: string[] = [];

function globalSettingsPath(agentDir: string): string {
  return path.join(agentDir, "settings.json");
}

function projectSettingsPath(cwd: string): string {
  return path.join(cwd, PROJECT_CONFIG_DIR, "settings.json");
}

export async function readWorkflowSettings(cwd: string, agentDir: string, projectTrusted: boolean): Promise<WorkflowSettings> {
  const globalWorkflow = await readWorkflowSettingsObject(globalSettingsPath(agentDir));
  const projectWorkflow = projectTrusted ? await readWorkflowSettingsObject(projectSettingsPath(cwd)) : {};
  return normalizeWorkflowSettings({ ...globalWorkflow, ...projectWorkflow });
}

export async function readProjectWorkflowSettings(cwd: string): Promise<WorkflowSettings> {
  return normalizeWorkflowSettings(await readWorkflowSettingsObject(projectSettingsPath(cwd)));
}

export async function writeGlobalWorkflowSettings(agentDir: string, settings: WorkflowSettingsPatch): Promise<void> {
  const settingsPath = globalSettingsPath(agentDir);
  await withFileMutationQueue(settingsPath, () => writeWorkflowSettingsFile(settingsPath, settings));
}

export async function writeProjectWorkflowSettings(cwd: string, settings: WorkflowSettingsPatch): Promise<void> {
  const settingsPath = projectSettingsPath(cwd);
  await withFileMutationQueue(settingsPath, () => writeWorkflowSettingsFile(settingsPath, settings));
}

function normalizeMaxParallelAgents(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    throw new Error("workflow.maxParallelAgents must be a positive integer");
  return value;
}

function normalizeChildAgentExtensions(value: unknown): string[] {
  if (value === undefined) return [...DEFAULT_CHILD_AGENT_EXTENSIONS];
  if (!Array.isArray(value)) throw new Error("workflow.childAgentExtensions must be an array of non-empty strings");
  const extensions: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new Error("workflow.childAgentExtensions must be an array of non-empty strings");
    }
    extensions.push(entry.trim());
  }
  return extensions;
}

function normalizeWorkflowDirs(value: unknown): string[] {
  if (value === undefined) return [...DEFAULT_WORKFLOW_DIRS];
  if (!Array.isArray(value)) throw new Error('workflow config must use { "workflowDirs": ["path"] } when workflowDirs is present');
  const workflowDirs: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new Error('workflow config must use { "workflowDirs": ["path"] } when workflowDirs is present');
    }
    workflowDirs.push(entry.trim());
  }
  return workflowDirs;
}

async function readWorkflowSettingsObject(settingsPath: string): Promise<Record<string, unknown>> {
  let rawSettings: unknown;
  try {
    rawSettings = JSON.parse(await readFile(settingsPath, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return {};
    throw error;
  }
  if (!isRecord(rawSettings)) throw new Error(`${settingsPath} must contain a JSON object`);
  const workflow = rawSettings.workflow;
  if (workflow === undefined) return {};
  if (!isRecord(workflow)) throw new Error("workflow settings must be an object");
  return workflow;
}

function normalizeWorkflowSettings(workflow: Record<string, unknown>): WorkflowSettings {
  return {
    workflowDirs: normalizeWorkflowDirs(workflow.workflowDirs),
    maxParallelAgents: normalizeMaxParallelAgents(workflow.maxParallelAgents ?? DEFAULT_MAX_PARALLEL_AGENTS),
    childAgentExtensions: normalizeChildAgentExtensions(workflow.childAgentExtensions),
  };
}

async function writeWorkflowSettingsFile(settingsPath: string, settings: WorkflowSettingsPatch): Promise<void> {
  const patch = normalizeWorkflowSettingsPatch(settings);
  let rawSettings: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as unknown;
    if (!isRecord(parsed)) throw new Error(`${settingsPath} must contain a JSON object`);
    rawSettings = parsed;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }
  const workflow = isRecord(rawSettings.workflow) ? rawSettings.workflow : {};
  rawSettings.workflow = { ...workflow, ...patch };
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFileAtomic(settingsPath, `${JSON.stringify(rawSettings, null, 2)}\n`);
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.${String(process.pid)}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function normalizeWorkflowSettingsPatch(settings: WorkflowSettingsPatch): WorkflowSettingsPatch {
  const patch: WorkflowSettingsPatch = {};
  if (settings.workflowDirs !== undefined) patch.workflowDirs = normalizeWorkflowDirs(settings.workflowDirs);
  if (settings.maxParallelAgents !== undefined) patch.maxParallelAgents = normalizeMaxParallelAgents(settings.maxParallelAgents);
  if (settings.childAgentExtensions !== undefined)
    patch.childAgentExtensions = normalizeChildAgentExtensions(settings.childAgentExtensions);
  return patch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
