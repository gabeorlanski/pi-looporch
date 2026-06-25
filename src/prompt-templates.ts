import { readFileSync } from "node:fs";
import { workflowPrimitiveSummaryList } from "./authoring-guide.ts";
import type { WorkflowInputContract } from "./input.ts";
import type { WorkflowAgentOptions, WorkflowMetadata } from "./runtime.ts";

const sessionRequestTemplate = readFileSync(new URL("./prompts/session-request.txt", import.meta.url), "utf8").trim();
const agentTaskTemplate = readFileSync(new URL("./prompts/agent-task.txt", import.meta.url), "utf8").trim();

export interface SteerableInputResolutionOptions {
  rawInput: string;
  workflowName: string;
  metadata: WorkflowMetadata;
  contract: WorkflowInputContract;
}

export function steerableInputResolutionMessage(options: SteerableInputResolutionOptions): string {
  return [
    `Resolve input for workflow '${options.workflowName}' in this normal conversation.`,
    "",
    "Use the workflow metadata inputInstructions and default workflow function input contract as the authority.",
    "If required input is missing or ambiguous, ask the user a concise clarification question instead of calling tools.",
    "The user may interrupt or steer you before the workflow starts; incorporate that guidance.",
    "When the input is complete, call run_workflow with the workflow name and JSON input. Do not run the workflow before then.",
    "",
    "Workflow metadata:",
    JSON.stringify({
      name: options.workflowName,
      description: options.metadata.description,
      inputInstructions: options.metadata.inputInstructions,
      phases: options.metadata.phases,
    }),
    "",
    "Workflow function input contract:",
    JSON.stringify(options.contract),
    "",
    "User command input:",
    options.rawInput,
  ].join("\n");
}

export function naturalLanguageRequestMessage(request: string, availableWorkflowNames: string[]): string {
  return renderPromptTemplate(sessionRequestTemplate, {
    availableWorkflowNames: availableWorkflowNames.length ? availableWorkflowNames.join(", ") : "none",
    request,
    workflowPrimitiveSummary: workflowPrimitiveSummaryList(),
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
