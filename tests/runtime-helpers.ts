import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkflowLLM, WorkflowLLMCompletion } from "../src/runtime/types.ts";

/** Explicit unavailable direct-call adapter for non-LLM runtime tests. */
export const unavailableLLM: WorkflowLLM = () => Promise.reject(new Error("Direct LLM calls are unavailable in this test"));

export function llmCompletion(text: string, overrides: Partial<Omit<WorkflowLLMCompletion, "text">> = {}): WorkflowLLMCompletion {
  return {
    text,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: { knownUsd: 0, complete: false },
    ...overrides,
  };
}

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
