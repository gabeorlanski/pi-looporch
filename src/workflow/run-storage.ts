/** Defines session-scoped temporary storage for workflow runs. */
import { rm } from "node:fs/promises";
import path from "node:path";

const WORKFLOW_TEMP_ROOT = "/tmp/pi-looporch";

/** Returns the canonical filesystem-safe project slug used by workflow storage. */
export function workflowProjectSlug(cwd: string): string {
  return path.resolve(cwd).replace(/[/\\:]/g, "-");
}

/** Returns the temporary directory owned by one live Pi session. */
function workflowSessionDirectory(cwd: string, sessionId: string): string {
  return path.join(WORKFLOW_TEMP_ROOT, workflowProjectSlug(cwd), storageComponent(sessionId));
}

/** Returns the temporary output and checkpoint directory for one workflow run. */
export function workflowRunDirectory(cwd: string, sessionId: string, runId: string): string {
  return path.join(workflowRunsDirectory(cwd, sessionId), storageComponent(runId));
}

/** Returns the temporary directory containing every workflow run for one live Pi session. */
export function workflowRunsDirectory(cwd: string, sessionId: string): string {
  return path.join(workflowSessionDirectory(cwd, sessionId), "runs");
}

/** Removes all temporary workflow state owned by one ending Pi session. */
export async function removeWorkflowSessionDirectory(cwd: string, sessionId: string): Promise<void> {
  await rm(workflowSessionDirectory(cwd, sessionId), { recursive: true, force: true });
}

/** Returns the temporary project directory containing every live session registry. */
export function workflowProjectDirectory(cwd: string): string {
  return path.join(WORKFLOW_TEMP_ROOT, workflowProjectSlug(cwd));
}

/** Encodes an untrusted identifier as one non-traversing storage path component. */
function storageComponent(value: string): string {
  return encodeURIComponent(value).replaceAll(".", "%2E");
}
