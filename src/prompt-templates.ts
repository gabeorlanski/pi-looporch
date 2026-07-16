/** Provides prompt templates behavior. */
import { readFileSync } from "node:fs";
import { defaultWorkflowDraftRoot } from "./workflow/drafts.ts";
import type { WorkflowAgentOptions, WorkflowMetadata } from "./runtime/types.ts";
import type { WorkflowInputContract } from "./workflow/input-contract.ts";

const sessionRequestTemplate = readFileSync(new URL("./prompts/session-request.txt", import.meta.url), "utf8").trim();
const workflowInputResolutionTemplate = readFileSync(new URL("./prompts/workflow-input-resolution.txt", import.meta.url), "utf8").trim();
const agentTaskTemplate = readFileSync(new URL("./prompts/agent-task.txt", import.meta.url), "utf8").trim();
const structuredOutputTemplate = readFileSync(new URL("./prompts/structured-output.txt", import.meta.url), "utf8").trim();
const workflowCompletionHandoffTemplate = readFileSync(
  new URL("./prompts/workflow-completion-handoff.txt", import.meta.url),
  "utf8",
).trim();
const workflowFailureHandoffTemplate = readFileSync(new URL("./prompts/workflow-failure-handoff.txt", import.meta.url), "utf8").trim();

export interface SteerableInputResolutionOptions {
  rawInput: string;
  workflowName: string;
  metadata: WorkflowMetadata;
  contract: WorkflowInputContract;
}

/** Provides the steerableInputResolutionMessage function contract. */
export function steerableInputResolutionMessage(options: SteerableInputResolutionOptions): string {
  return renderPromptTemplate(workflowInputResolutionTemplate, {
    metadata: JSON.stringify({
      name: options.workflowName,
      description: options.metadata.description,
      inputInstructions: options.metadata.inputInstructions,
      phases: options.metadata.phases,
    }),
    inputContract: JSON.stringify(options.contract),
    request: options.rawInput,
  });
}

/** Provides the naturalLanguageRequestMessage function contract. */
export function naturalLanguageRequestMessage(request: string, availableWorkflowNames: string[]): string {
  return renderPromptTemplate(sessionRequestTemplate, {
    availableWorkflowNames: availableWorkflowNames.length ? availableWorkflowNames.join(", ") : "none",
    defaultWorkflowDraftRoot: defaultWorkflowDraftRoot(),
    request,
  });
}

/** Provides the agentTaskPrompt function contract. */
export function agentTaskPrompt(prompt: string, options: WorkflowAgentOptions): string {
  const segments = agentTaskTemplate.split("{{prompt}}");
  if (segments.length !== 2) throw new Error("agent task template must contain exactly one '{{prompt}}' placeholder");
  const [beforePrompt, afterPrompt] = segments;
  const context = JSON.stringify({
    ...(options.label ? { label: options.label } : {}),
    ...(options.taskFile ? { taskFile: options.taskFile } : {}),
  });
  const task =
    `${interpolatePromptTemplate(beforePrompt, { context })}${prompt}${interpolatePromptTemplate(afterPrompt, { context })}`.trim();
  return task.replace("{{structuredOutput}}", options.schema === undefined ? "" : structuredOutputPrompt(options.schema));
}

/** Renders the terminal structured-output contract for a schema-enabled workflow task. */
export function structuredOutputPrompt(schema: unknown): string {
  return renderPromptTemplate(structuredOutputTemplate, { schema: JSON.stringify(schema) });
}

/** Renders a typed automated handoff after a workflow completes. */
export function workflowCompletionHandoffPrompt(metadata: unknown, result: string, paths: string): string {
  return renderPromptTemplate(workflowCompletionHandoffTemplate, {
    metadata: JSON.stringify(metadata),
    result,
    paths,
  });
}

/** Renders a typed automated handoff after a workflow fails. */
export function workflowFailureHandoffPrompt(workflowName: string, failure: string): string {
  return renderPromptTemplate(workflowFailureHandoffTemplate, { workflowName, failure });
}

function renderPromptTemplate(template: string, values: Record<string, string>): string {
  return interpolatePromptTemplate(template, values).trim();
}

function interpolatePromptTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((rendered, [key, value]) => rendered.replaceAll(`{{${key}}}`, escapePromptValue(value)), template);
}

function escapePromptValue(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
