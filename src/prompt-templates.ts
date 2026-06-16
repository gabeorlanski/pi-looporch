import { readFileSync } from "node:fs";
import type { WorkflowReference } from "./discovery.ts";
import type { WorkflowAgentOptions, WorkflowMetadata } from "./runtime.ts";
import { workflowAuthoringGuide } from "./authoring-guide.ts";

const inputResolutionTemplate = readFileSync(new URL("./prompts/input-resolution.txt", import.meta.url), "utf8").trim();
const selectionTemplate = readFileSync(new URL("./prompts/selection.txt", import.meta.url), "utf8").trim();
const sessionRequestTemplate = readFileSync(new URL("./prompts/session-request.txt", import.meta.url), "utf8").trim();
const agentTaskTemplate = readFileSync(new URL("./prompts/agent-task.txt", import.meta.url), "utf8").trim();

export interface InputResolutionPromptOptions {
  rawInput: string;
  workflowName: string;
  metadata: WorkflowMetadata;
  source: string;
}

export function inputResolutionPrompt(options: InputResolutionPromptOptions): string {
  return renderPromptTemplate(inputResolutionTemplate, {
    workflowMetadata: JSON.stringify({ name: options.workflowName, description: options.metadata.description }, null, 2),
    workflowSource: options.source,
    rawInput: options.rawInput,
  });
}

export function selectionPrompt(request: string, workflows: WorkflowReference[]): string {
  return renderPromptTemplate(selectionTemplate, {
    workflowAuthoringGuide: workflowAuthoringGuide(),
    availableWorkflows: JSON.stringify(
      workflows.map((workflow) => ({
        name: workflow.name,
        description: workflow.metadata.description,
      })),
      null,
      2,
    ),
    request,
  });
}

export function naturalLanguageRequestMessage(request: string, availableWorkflowNames: string[]): string {
  return renderPromptTemplate(sessionRequestTemplate, {
    workflowAuthoringGuide: workflowAuthoringGuide(),
    availableWorkflowNames: availableWorkflowNames.length ? availableWorkflowNames.join(", ") : "none",
    request,
  });
}

export function agentTaskPrompt(prompt: string, options: WorkflowAgentOptions): string {
  const context = [options.label ? `Workflow task label: ${options.label}` : "", options.taskFile ? `Task file: ${options.taskFile}` : ""]
    .filter(Boolean)
    .join("\n\n");
  return renderPromptTemplate(agentTaskTemplate, { context, prompt }).trim();
}

function renderPromptTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values)
    .reduce((rendered, [key, value]) => rendered.replaceAll(`{{${key}}}`, value), template)
    .trim();
}
