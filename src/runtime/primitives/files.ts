import path from "node:path";
import { readWorkflowJson, readWorkflowText, writeWorkflowJson, writeWorkflowText } from "../../workflow/files.ts";
import type { WorkflowPrimitive } from "../context.ts";
import { renderWorkflowPrompt } from "../prompts.ts";

export const filePrimitive: WorkflowPrimitive<{
  readText: (filePath: string) => string;
  readJson: (filePath: string) => unknown;
  writeText: (filePath: string, content: string) => string;
  writeJson: (filePath: string, value: unknown) => string;
  renderPrompt: (templatePath: string, values: unknown) => string;
}> = {
  name: "files",
  globals: ({ runtime, workflowDir }) => ({
    readText: (filePath: string) => readWorkflowText(runtime.options.cwd, workflowDir, filePath),
    readJson: (filePath: string) => readWorkflowJson(runtime.options.cwd, workflowDir, filePath),
    writeText: (filePath: string, content: string) => writeWorkflowText(runtime.options.cwd, workflowDir, filePath, content),
    writeJson: (filePath: string, value: unknown) => writeWorkflowJson(runtime.options.cwd, workflowDir, filePath, value),
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
