import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveWorkflowReadPath } from "../../workflow/paths.ts";
import type { WorkflowPrimitive } from "../context.ts";
import { renderWorkflowPrompt } from "../prompts.ts";

export const filePrimitive: WorkflowPrimitive<{
  readText: (filePath: string) => string;
  readJson: (filePath: string) => unknown;
  renderPrompt: (templatePath: string, values: unknown) => string;
}> = {
  name: "files",
  globals: ({ runtime, workflowDir }) => ({
    readText: (filePath: string) => readFileSync(resolveWorkflowReadPath(runtime.options.cwd, workflowDir, filePath), "utf8"),
    readJson: (filePath: string) =>
      JSON.parse(readFileSync(resolveWorkflowReadPath(runtime.options.cwd, workflowDir, filePath), "utf8")) as unknown,
    renderPrompt: (templatePath: string, values: unknown) => renderWorkflowPrompt(workflowDir, templatePath, values),
  }),
};

export const environmentPrimitive: WorkflowPrimitive<{
  cwd: string;
  budget: { readonly agentCount: number; readonly tokenCount: number };
}> = {
  name: "environment",
  globals: ({ runtime }) => ({
    cwd: path.resolve(runtime.options.cwd),
    budget: {
      get agentCount() {
        return runtime.snapshot.agents.length;
      },
      get tokenCount() {
        return runtime.snapshot.agents.reduce((total, agent) => total + agent.inputTokenCount + agent.outputTokenCount, 0);
      },
    },
  }),
};
