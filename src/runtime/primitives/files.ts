/** Provides files behavior. */
import path from "node:path";
import { readWorkflowJson, readWorkflowText, writeWorkflowJson, writeWorkflowText } from "../../workflow/files.ts";
import type { WorkflowPrimitive } from "../context.ts";
import { renderWorkflowPrompt } from "../prompts.ts";
import { workflowUsageTotals } from "../usage.ts";

export const filePrimitive: WorkflowPrimitive<{
  readText: (filePath: string) => string;
  readJson: (filePath: string) => unknown;
  writeText: (filePath: string, content: string) => string;
  writeJson: (filePath: string, value: unknown) => string;
  renderPrompt: (templatePath: string, values: unknown) => string;
}> = {
  name: "files",
  docs: [
    {
      name: "readText",
      signature: "readText(filePath)",
      summary: "Reads UTF-8 text from an absolute path, project-cwd relative path, or @workflow/... path.",
    },
    {
      name: "readJson",
      signature: "readJson(filePath)",
      summary: "Reads and parses JSON from an absolute path, project-cwd relative path, or @workflow/... path.",
    },
    {
      name: "writeText",
      signature: "writeText(filePath, content)",
      summary: "Atomically writes UTF-8 text and returns the resolved absolute path.",
    },
    {
      name: "writeJson",
      signature: "writeJson(filePath, value)",
      summary: "Pretty-prints JSON atomically and returns the resolved absolute path.",
    },
    {
      name: "renderPrompt",
      signature: "renderPrompt(templatePath, values)",
      summary: "Renders a workflow-owned prompts/ template with {{name}} placeholders.",
    },
  ],
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
  docs: [
    { name: "cwd", signature: "cwd", summary: "Absolute project working directory for this workflow run." },
    {
      name: "budget",
      signature: "budget.agentCount / budget.tokenCount",
      summary: "Observed child-agent and token counters for the current run; values are usage, not estimates.",
    },
  ],
  globals: ({ runtime }) => ({
    cwd: path.resolve(runtime.options.cwd),
    budget: {
      get agentCount() {
        return runtime.snapshot.agents.length;
      },
      get tokenCount() {
        return workflowUsageTotals(runtime.snapshot).tokensTotal;
      },
    },
  }),
};
