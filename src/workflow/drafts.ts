/** Provides drafts behavior. */
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractWorkflowInputContract } from "./input-contract.ts";
import { parseWorkflowSourceMetadata } from "./metadata.ts";
import { isInsideOrEqual } from "./paths.ts";
import { analyzeWorkflowSource, type WorkflowSourceAnalysis } from "./source-analysis.ts";

export interface WorkflowDraft {
  name: string;
  source: string;
  sourceDirectory: string;
}

export interface WorkflowDraftReadOptions {
  cwd: string;
  name: string;
  draftDir?: string;
}

/** Reads a directory-backed generated workflow draft into the canonical save shape. */
export async function readWorkflowDraft(options: WorkflowDraftReadOptions): Promise<WorkflowDraft> {
  const sourceDirectory = resolveDraftWorkflowDirectory(options.cwd, options.draftDir ?? defaultWorkflowDraftDirectory(options.name));
  const stats = await stat(sourceDirectory);
  if (!stats.isDirectory()) throw new Error("propose_workflow draftDir must be a directory containing workflow.js");
  const source = await readFile(path.join(sourceDirectory, "workflow.js"), "utf8");
  const analysis = analyzeWorkflowSource(source);
  validateDraftDocstring(source, analysis);
  parseWorkflowSourceMetadata(source, options.name, "workflow.js", analysis);
  return {
    name: options.name,
    source,
    sourceDirectory,
  };
}

/** Provides the defaultWorkflowDraftRoot function contract. */
export function defaultWorkflowDraftRoot(): string {
  return path.join(tmpdir(), "pi-workflow-drafts");
}

/** Provides the defaultWorkflowDraftDirectory function contract. */
export function defaultWorkflowDraftDirectory(name: string): string {
  return path.join(defaultWorkflowDraftRoot(), name);
}

function resolveDraftWorkflowDirectory(cwd: string, draftDir: string): string {
  const projectRoot = path.resolve(cwd);
  const resolved = path.resolve(projectRoot, draftDir);
  const publishedRoot = path.join(projectRoot, ".pi", "workflows");
  if (isInsideOrEqual(publishedRoot, resolved) || isInsideOrEqual(resolved, publishedRoot)) {
    throw new Error("propose_workflow draftDir must not be inside, equal to, or an ancestor of .pi/workflows");
  }
  return resolved;
}

function validateDraftDocstring(source: string, analysis: WorkflowSourceAnalysis): void {
  const contract = extractWorkflowInputContract(source, analysis);
  if (!contract.jsdoc) throw new Error("Generated workflow function must start with a JSDoc docstring before it can be saved");
  const normalized = contract.jsdoc.toLowerCase();
  for (const requiredTopic of ["input", "phase", "agent", "result"]) {
    if (!normalized.includes(requiredTopic))
      throw new Error(`Generated workflow function JSDoc must document ${requiredTopic} before the workflow can be saved`);
  }
}
