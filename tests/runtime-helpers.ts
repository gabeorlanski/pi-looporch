import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkflowLLM } from "../src/runtime/types.ts";

/** Explicit unavailable direct-call adapter for non-LLM runtime tests. */
export const unavailableLLM: WorkflowLLM = () => Promise.reject(new Error("Direct LLM calls are unavailable in this test"));

export async function writeWorkflow(project: string, name: string, source: string, files: Record<string, string> = {}): Promise<void> {
  const workflowDir = path.join(project, ".pi", "workflows", name);
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, "workflow.js"), source, "utf8");
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(workflowDir, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}
