import path from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { PROJECT_CONFIG_DIR } from "./config-dir.ts";

export function workflowPublishQueuePath(cwd: string): string {
  return path.join(path.resolve(cwd), PROJECT_CONFIG_DIR, "workflows");
}

export async function withWorkflowPublishLock<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  return await withFileMutationQueue(workflowPublishQueuePath(cwd), fn);
}
