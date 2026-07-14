/** Provides paths behavior. */
import { existsSync } from "node:fs";
import path from "node:path";

/** Provides the normalizeWorkflowName function contract. */
export function normalizeWorkflowName(workflowName: string): string {
  const normalized = workflowName.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(normalized)) throw new Error(`Invalid workflow name: ${workflowName}`);
  return normalized;
}

/** Provides the resolveWorkflowDirectory function contract. */
export function resolveWorkflowDirectory(cwd: string, workflowName: string, workflowRoots: string[] | undefined): string {
  for (const root of workflowRoots?.length ? workflowRoots : [path.resolve(cwd, ".pi", "workflows")]) {
    const direct = path.resolve(root);
    const child = path.join(direct, workflowName);
    if (existsSync(path.join(child, "workflow.js"))) return child;
  }
  throw new Error(`Workflow '${workflowName}' not found`);
}

/** Provides the resolveWorkflowReadPath function contract. */
export function resolveWorkflowReadPath(cwd: string, workflowDir: string, filePath: string): string {
  if (typeof filePath !== "string" || !filePath.trim()) throw new Error("Workflow file path must be non-empty");
  if (filePath === "@workflow" || filePath.startsWith("@workflow/")) {
    const workflowPath = filePath === "@workflow" ? "." : filePath.slice("@workflow/".length);
    return resolveInsideRoot(workflowDir, workflowPath, "Workflow-local file escapes workflow directory");
  }
  return path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(cwd, filePath);
}

/** Provides the resolveWorkflowAgentCwd function contract. */
export function resolveWorkflowAgentCwd(cwd: string, agentCwd: unknown): string | undefined {
  if (agentCwd === undefined) return undefined;
  if (typeof agentCwd !== "string" || !agentCwd.trim()) throw new Error("agent cwd must be a non-empty string");
  const requestedCwd = agentCwd.trim();
  return path.isAbsolute(requestedCwd) ? path.resolve(requestedCwd) : path.resolve(cwd, requestedCwd);
}

/** Provides the resolveInsideRoot function contract. */
export function resolveInsideRoot(root: string, relativePath: string, escapeMessage: string): string {
  const target = path.resolve(root, relativePath.replace(/^@/, ""));
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${escapeMessage}: ${relativePath}`);
  return target;
}

/** Returns whether target is root itself or lies beneath it. */
export function isInsideOrEqual(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
