import { cp, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GeneratedWorkflowDraft, WorkflowProposal } from "./request.ts";
import { parseWorkflowSourceMetadata } from "./runtime.ts";

export interface WorkflowDraftReadOptions {
  cwd: string;
  name: string;
  source?: string;
  draftDir?: string;
  proposal: WorkflowProposal;
  toolName: string;
}

/** Reads an inline or directory-backed generated workflow draft into the canonical review shape. */
export async function readWorkflowDraft(options: WorkflowDraftReadOptions): Promise<GeneratedWorkflowDraft> {
  const { source, sourceDirectory, filePaths } = await readWorkflowDraftSource(options);
  return {
    name: options.name,
    source,
    metadata: parseWorkflowSourceMetadata(source, options.name),
    proposal: options.proposal,
    filePaths,
    ...(sourceDirectory ? { sourceDirectory } : {}),
  };
}

/** Builds the default human-facing proposal summary for a generated workflow draft. */
export function workflowDraftProposal(
  params: { request?: string; summary?: string; steps?: string[]; willRun?: string[] },
  name: string,
): WorkflowProposal {
  return {
    summary: params.summary ?? `Create workflow '${name}'${params.request ? ` for: ${params.request}` : ""}`,
    steps: params.steps ?? ["Save the reviewed workflow directory under the project workflow root."],
    willRun: params.willRun ?? [`Copy the approved draft directory to .pi/workflows/${name}/ after approval.`],
  };
}

/** Copies an approved generated workflow draft into a temporary workflow root for one run. */
export async function materializeWorkflowDraftForRun(draft: GeneratedWorkflowDraft): Promise<string> {
  const workflowRoot = await mkdtemp(path.join(tmpdir(), "pi-workflow-draft-run-"));
  const workflowDir = path.join(workflowRoot, draft.name);
  if (draft.sourceDirectory) await cp(draft.sourceDirectory, workflowDir, { recursive: true });
  else await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, "workflow.js"), `${draft.source.trim()}\n`, "utf8");
  return workflowRoot;
}

async function readWorkflowDraftSource(
  options: WorkflowDraftReadOptions,
): Promise<{ source: string; filePaths: string[]; sourceDirectory?: string }> {
  const hasSource = typeof options.source === "string";
  const hasDraftDir = typeof options.draftDir === "string" && options.draftDir.trim().length > 0;
  if (hasSource && hasDraftDir) throw new Error(`${options.toolName} requires exactly one of source or draftDir`);
  if (!hasSource && !hasDraftDir) throw new Error(`${options.toolName} requires exactly one of source or draftDir`);
  if (hasSource) return { source: options.source ?? "", filePaths: ["workflow.js"] };
  if (typeof options.draftDir !== "string" || !options.draftDir.trim()) {
    throw new Error(`${options.toolName} requires exactly one of source or draftDir`);
  }
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
