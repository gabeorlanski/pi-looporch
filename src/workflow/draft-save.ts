/** Provides draft save behavior. */
import { cp, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { isMissingFileError } from "../errors.ts";
import type { WorkflowMetadata } from "../runtime/types.ts";
import { extractWorkflowInputContract } from "./input-contract.ts";
import { parseWorkflowSourceMetadata } from "./metadata.ts";
import { isInsideOrEqual } from "./paths.ts";

/** Complete generated workflow draft plus source files ready to save. */
export interface GeneratedWorkflowDraft {
  name: string;
  source: string;
  metadata: WorkflowMetadata;
  filePaths: string[];
  sourceDirectory: string;
}

/** Inputs for saving a generated workflow draft. */
export interface SaveWorkflowDraftOptions {
  cwd: string;
  draft: GeneratedWorkflowDraft;
}

/** Validates and atomically saves a generated workflow draft under .pi/workflows. */
export async function saveWorkflowDraft(options: SaveWorkflowDraftOptions): Promise<GeneratedWorkflowDraft> {
  validateDraftDocstring(options.draft.source);
  const draft = { ...options.draft, metadata: parseWorkflowSourceMetadata(options.draft.source, options.draft.name) };
  await saveDraft(options.cwd, draft);
  return draft;
}

/** Ensures generated workflow source has default-function JSDoc covering the required runbook topics. */
function validateDraftDocstring(source: string): void {
  const contract = extractWorkflowInputContract(source);
  if (!contract.jsdoc) throw new Error("Generated workflow function must start with a JSDoc docstring before it can be saved");
  const normalized = contract.jsdoc.toLowerCase();
  for (const requiredTopic of ["input", "phase", "agent", "result"]) {
    if (!normalized.includes(requiredTopic))
      throw new Error(`Generated workflow function JSDoc must document ${requiredTopic} before the workflow can be saved`);
  }
}

async function saveDraft(cwd: string, draft: GeneratedWorkflowDraft): Promise<void> {
  const workflowRoot = path.join(path.resolve(cwd), ".pi", "workflows");
  const workflowDir = path.join(workflowRoot, draft.name);
  const suffix = `${String(process.pid)}-${String(Date.now())}`;
  const stagingDir = path.join(workflowRoot, `.${draft.name}.tmp-${suffix}`);
  const backupDir = path.join(workflowRoot, `.${draft.name}.old-${suffix}`);
  await Promise.all([
    rm(stagingDir, { recursive: true, force: true }),
    rm(backupDir, { recursive: true, force: true }),
    mkdir(workflowRoot, { recursive: true }),
  ]);
  await cp(validateDraftSourceDirectory(draft.sourceDirectory, workflowRoot), stagingDir, { recursive: true });
  await replaceWorkflowDirectory(workflowDir, stagingDir, backupDir);
}

async function replaceWorkflowDirectory(workflowDir: string, stagingDir: string, backupDir: string): Promise<void> {
  const hadExistingWorkflow = await renameIfExists(workflowDir, backupDir);
  try {
    await rename(stagingDir, workflowDir);
  } catch (error) {
    if (hadExistingWorkflow) await rename(backupDir, workflowDir);
    throw error;
  }
  if (hadExistingWorkflow) await rm(backupDir, { recursive: true, force: true });
}

async function renameIfExists(from: string, to: string): Promise<boolean> {
  try {
    await rename(from, to);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

function validateDraftSourceDirectory(sourceDirectory: string, workflowRoot: string): string {
  const resolved = path.resolve(sourceDirectory);
  if (isInsideOrEqual(workflowRoot, resolved) || isInsideOrEqual(resolved, workflowRoot)) {
    throw new Error("Workflow draft source directory must not be inside, equal to, or an ancestor of .pi/workflows");
  }
  return resolved;
}
