import { cp, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { extractWorkflowInputContract } from "./input.ts";
import type { WorkflowMetadata } from "./runtime/types.ts";
import { parseWorkflowSourceMetadata } from "./workflow/metadata.ts";

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
  const draft = validatedWorkflowDraft(options.draft);
  await saveDraft(options.cwd, draft);
  return draft;
}

function validatedWorkflowDraft(draft: GeneratedWorkflowDraft): GeneratedWorkflowDraft {
  validateGeneratedWorkflowDocstring(draft.source);
  const metadata = parseWorkflowSourceMetadata(draft.source, draft.name);
  return { ...draft, metadata };
}

/** Ensures generated workflow source has default-function JSDoc covering the required runbook topics. */
function validateGeneratedWorkflowDocstring(source: string): void {
  const contract = extractWorkflowInputContract(source);
  if (!contract.jsdoc) throw new Error("Generated workflow function must start with a JSDoc docstring before it can be saved");
  const normalized = contract.jsdoc.toLowerCase();
  for (const requiredTopic of ["input", "phase", "agent", "result"]) {
    if (!normalized.includes(requiredTopic))
      throw new Error(`Generated workflow function JSDoc must document ${requiredTopic} before the workflow can be saved`);
  }
}

async function saveDraft(cwd: string, draft: GeneratedWorkflowDraft): Promise<void> {
  const projectRoot = path.resolve(cwd);
  const workflowRoot = path.join(projectRoot, ".pi", "workflows");
  const workflowDir = path.join(workflowRoot, draft.name);
  const suffix = `${String(process.pid)}-${String(Date.now())}`;
  const stagingDir = path.join(workflowRoot, `.${draft.name}.tmp-${suffix}`);
  const backupDir = path.join(workflowRoot, `.${draft.name}.old-${suffix}`);
  await Promise.all([
    rm(stagingDir, { recursive: true, force: true }),
    rm(backupDir, { recursive: true, force: true }),
    mkdir(workflowRoot, { recursive: true }),
  ]);
  await cp(validateDraftSourceDirectory(projectRoot, draft.sourceDirectory, workflowRoot), stagingDir, { recursive: true });
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
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

function validateDraftSourceDirectory(projectRoot: string, sourceDirectory: string, workflowRoot: string): string {
  const resolved = path.resolve(sourceDirectory);
  if (!isInsideOrEqual(projectRoot, resolved)) throw new Error("Workflow draft source directory must stay inside the project directory");
  if (isInsideOrEqual(workflowRoot, resolved) || isInsideOrEqual(resolved, workflowRoot)) {
    throw new Error("Workflow draft source directory must not be inside, equal to, or an ancestor of .pi/workflows");
  }
  return resolved;
}

function isInsideOrEqual(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";
}
