import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeWorkflowName, parseWorkflowSourceMetadata, type WorkflowMetadata } from "./runtime.ts";

export interface WorkflowReference {
  name: string;
  dir: string;
  entryFile: string;
  metadata: WorkflowMetadata;
}

interface WorkflowSettings {
  workflowDirs: string[];
}

export async function workflowRootsForProject(cwd: string): Promise<string[]> {
  const projectRoot = path.resolve(cwd);
  const localRoot = path.join(projectRoot, ".pi", "workflows");
  const settings = await readWorkflowSettings(projectRoot);
  const configuredRoots = settings.workflowDirs.map((workflowDir) => path.resolve(projectRoot, workflowDir));
  return [...new Set([localRoot, ...configuredRoots])];
}

export async function discoverWorkflows(cwd: string): Promise<WorkflowReference[]> {
  const roots = await workflowRootsForProject(cwd);
  const byName = new Map<string, WorkflowReference>();
  for (const root of roots) {
    for (const workflow of await discoverWorkflowsInRoot(root)) {
      if (!byName.has(workflow.name)) byName.set(workflow.name, workflow);
    }
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function readWorkflowSettings(projectRoot: string): Promise<WorkflowSettings> {
  const settingsPath = path.join(projectRoot, ".pi", "settings.json");
  if (!existsSync(settingsPath)) return { workflowDirs: [] };
  const raw = await readFile(settingsPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const workflow = typeof parsed === "object" && parsed !== null ? (parsed as { workflow?: unknown }).workflow : undefined;
  if (workflow === undefined) return { workflowDirs: [] };
  if (!isWorkflowSettings(workflow)) {
    throw new Error('.pi/settings.json workflow config must contain { "workflowDirs": ["path"] }');
  }
  return workflow;
}

function isWorkflowSettings(value: unknown): value is WorkflowSettings {
  if (typeof value !== "object" || value === null) return false;
  const workflowDirs = (value as { workflowDirs?: unknown }).workflowDirs;
  return Array.isArray(workflowDirs) && workflowDirs.every((item) => typeof item === "string" && item.trim().length > 0);
}

async function discoverWorkflowsInRoot(root: string): Promise<WorkflowReference[]> {
  const absoluteRoot = path.resolve(root);
  const entries = await readDirectoryEntries(absoluteRoot);
  const workflows: WorkflowReference[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidWorkflowName(entry.name)) continue;
    const name = normalizeWorkflowName(entry.name);
    const dir = path.join(absoluteRoot, name);
    if (hasWorkflowEntry(dir)) {
      const workflow = await readWorkflowReferenceIfValid(dir, name);
      if (workflow) workflows.push(workflow);
    }
  }
  return workflows;
}

function isValidWorkflowName(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

async function readWorkflowReference(dir: string, name: string): Promise<WorkflowReference> {
  const entryFile = path.join(dir, "workflow.js");
  const source = await readFile(entryFile, "utf8");
  return { name, dir, entryFile, metadata: parseWorkflowSourceMetadata(source, name, entryFile) };
}

async function readWorkflowReferenceIfValid(dir: string, name: string): Promise<WorkflowReference | undefined> {
  try {
    return await readWorkflowReference(dir, name);
  } catch {
    return undefined;
  }
}

function hasWorkflowEntry(workflowDir: string): boolean {
  return existsSync(path.join(workflowDir, "workflow.js"));
}

async function readDirectoryEntries(directory: string) {
  if (!existsSync(directory)) return [];
  return readdir(directory, { withFileTypes: true, encoding: "utf8" });
}
