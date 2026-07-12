import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { WorkflowMetadata } from "./runtime/types.ts";
import { parseWorkflowSourceMetadata } from "./workflow/metadata.ts";
import { normalizeWorkflowName } from "./workflow/paths.ts";
import { readProjectWorkflowSettings } from "./workflow/settings.ts";

export interface WorkflowReference {
  name: string;
  dir: string;
  entryFile: string;
  metadata: WorkflowMetadata;
}

export async function workflowRootsForProject(cwd: string): Promise<string[]> {
  const projectRoot = path.resolve(cwd);
  const localRoot = path.join(projectRoot, ".pi", "workflows");
  const settings = await readProjectWorkflowSettings(projectRoot);
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

async function discoverWorkflowsInRoot(root: string): Promise<WorkflowReference[]> {
  const absoluteRoot = path.resolve(root);
  const entries = await readDirectoryEntries(absoluteRoot);
  const workflows: WorkflowReference[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidWorkflowName(entry.name)) continue;
    const name = normalizeWorkflowName(entry.name);
    const dir = path.join(absoluteRoot, name);
    if (existsSync(path.join(dir, "workflow.js"))) {
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

async function readDirectoryEntries(directory: string) {
  if (!existsSync(directory)) return [];
  return readdir(directory, { withFileTypes: true, encoding: "utf8" });
}
