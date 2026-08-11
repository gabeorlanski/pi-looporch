/** Provides draft save behavior. */
import { cp, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { isMissingFileError } from "../errors.ts";
import type { WorkflowDraft } from "./drafts.ts";
import { isInsideOrEqual } from "./paths.ts";

/** Inputs for saving a generated workflow draft. */
export interface SaveWorkflowDraftOptions {
  cwd: string;
  draft: WorkflowDraft;
}

/** Atomically saves a validated workflow draft under .pi/workflows. */
export async function saveWorkflowDraft(options: SaveWorkflowDraftOptions): Promise<void> {
  await saveDraft(options.cwd, options.draft);
}

async function saveDraft(cwd: string, draft: WorkflowDraft): Promise<void> {
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
