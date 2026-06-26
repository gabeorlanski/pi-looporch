import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractWorkflowInputContract } from "./input.ts";
import { parseWorkflowSourceMetadata, type WorkflowMetadata } from "./runtime.ts";

export interface WorkflowProposal {
  summary: string;
  steps: string[];
  willRun: string[];
}

export interface GeneratedWorkflowDraft {
  name: string;
  source: string;
  metadata: WorkflowMetadata;
  proposal: WorkflowProposal;
  filePaths: string[];
  sourceDirectory?: string;
}

export interface WorkflowReviewRequest {
  cwd: string;
  draft: GeneratedWorkflowDraft;
  request: string;
}

export type WorkflowReviewDecision = { action: "approve"; source?: string } | { action: "reject"; reason?: string };

export type WorkflowReviewer = (request: WorkflowReviewRequest) => Promise<WorkflowReviewDecision> | WorkflowReviewDecision;

export interface ReviewAndSaveWorkflowDraftOptions {
  cwd: string;
  request: string;
  draft: GeneratedWorkflowDraft;
  reviewer?: WorkflowReviewer;
}

export async function reviewAndSaveWorkflowDraft(options: ReviewAndSaveWorkflowDraftOptions): Promise<GeneratedWorkflowDraft> {
  if (!options.reviewer) throw new Error("Generated workflows require review before they are saved or run");
  const decision = await options.reviewer({ cwd: options.cwd, draft: options.draft, request: options.request });
  if (decision.action === "reject") throw new Error(decision.reason ?? "Generated workflow was rejected");
  const approvedSource = decision.source ?? options.draft.source;
  validateGeneratedWorkflowDocstring(approvedSource);
  const approvedMetadata = parseWorkflowSourceMetadata(approvedSource, options.draft.name);
  const approvedDraft = { ...options.draft, source: approvedSource, metadata: approvedMetadata };
  await saveApprovedDraft(options.cwd, approvedDraft);
  return approvedDraft;
}

export function validateGeneratedWorkflowDocstring(source: string): void {
  const contract = extractWorkflowInputContract(source);
  if (!contract.jsdoc) throw new Error("Generated workflow function must start with a JSDoc docstring before it can be saved");
  const normalized = contract.jsdoc.toLowerCase();
  for (const requiredTopic of ["input", "phase", "agent", "result"]) {
    if (!normalized.includes(requiredTopic))
      throw new Error(`Generated workflow function JSDoc must document ${requiredTopic} before the workflow can be saved`);
  }
}

async function saveApprovedDraft(cwd: string, draft: GeneratedWorkflowDraft): Promise<void> {
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
  if (draft.sourceDirectory) {
    await cp(validateDraftSourceDirectory(projectRoot, draft.sourceDirectory, workflowRoot), stagingDir, { recursive: true });
  } else {
    await mkdir(stagingDir, { recursive: true });
  }
  await writeFile(path.join(stagingDir, "workflow.js"), `${draft.source.trim()}\n`, "utf8");
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
