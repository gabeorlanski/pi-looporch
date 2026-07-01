import { readFileSync } from "node:fs";
import { defaultWorkflowDraftRoot } from "./workflow/drafts.ts";
import type { WorkflowInputContract } from "./input.ts";
import type { WorkflowAgentOptions, WorkflowMetadata } from "./runtime/types.ts";

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
    "You MUST try to resolve clear ambiguities from available context before asking the user.",
    "Search/read relevant project files, docs, tests, and existing workflows when the command input points to them or when required fields may be inferable.",
    "Ask a concise clarification question only when required input remains unknowable, multiple materially different interpretations remain plausible, or a high-impact choice would change the workflow scope, behavior, or artifacts.",
    "Proceed with stated assumptions for low-risk reversible details.",
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
    defaultWorkflowDraftRoot: defaultWorkflowDraftRoot(),
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
