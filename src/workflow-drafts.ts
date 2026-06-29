import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { GeneratedWorkflowDraft } from "./request.ts";
import { parseWorkflowSourceMetadata } from "./workflow-metadata.ts";

export interface WorkflowDraftReadOptions {
  cwd: string;
  name: string;
  draftDir: string;
  toolName: string;
}

/** Reads a directory-backed generated workflow draft into the canonical approval shape. */
export async function readWorkflowDraft(options: WorkflowDraftReadOptions): Promise<GeneratedWorkflowDraft> {
  const { source, sourceDirectory, filePaths } = await readWorkflowDraftSource(options);
  return {
    name: options.name,
    source,
    metadata: parseWorkflowSourceMetadata(source, options.name),
    filePaths,
    sourceDirectory,
  };
}

async function readWorkflowDraftSource(
  options: WorkflowDraftReadOptions,
): Promise<{ source: string; filePaths: string[]; sourceDirectory: string }> {
  if (!options.draftDir.trim()) throw new Error(`${options.toolName} requires draftDir`);
  const sourceDirectory = resolveDraftWorkflowDirectory(options.cwd, options.draftDir, options.toolName);
  const stats = await stat(sourceDirectory);
  if (!stats.isDirectory()) throw new Error(`${options.toolName} draftDir must be a directory containing workflow.js`);
  return {
    source: await readFile(path.join(sourceDirectory, "workflow.js"), "utf8"),
    sourceDirectory,
    filePaths: await listDraftFiles(sourceDirectory),
  };
}

async function listDraftFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(absolute);
          return;
        }
        if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join("/"));
      }),
    );
  };
  await walk(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function resolveDraftWorkflowDirectory(cwd: string, draftDir: string, toolName: string): string {
  const projectRoot = path.resolve(cwd);
  const resolved = path.resolve(projectRoot, draftDir);
  const projectRelative = path.relative(projectRoot, resolved);
  if (projectRelative.startsWith("..") || path.isAbsolute(projectRelative)) {
    throw new Error(`${toolName} draftDir must stay inside the project directory`);
  }
  const publishedRoot = path.join(projectRoot, ".pi", "workflows");
  if (isInsideOrEqual(publishedRoot, resolved) || isInsideOrEqual(resolved, publishedRoot)) {
    throw new Error(`${toolName} draftDir must not be inside, equal to, or an ancestor of .pi/workflows`);
  }
  return resolved;
}

function isInsideOrEqual(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
