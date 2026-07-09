import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveInsideRoot } from "../workflow/paths.ts";

export function renderPromptTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/{{\s*([A-Za-z_$][\w$]*)\s*}}/g, (_match, key: string) => promptTemplateValue(context[key]));
}

export function renderWorkflowPrompt(workflowDir: string, templatePath: string, values: unknown): string {
  if (typeof templatePath !== "string" || !templatePath.trim()) throw new Error("renderPrompt templatePath must be non-empty");
  if (typeof values !== "object" || values === null || Array.isArray(values)) throw new Error("renderPrompt values must be an object");
  return renderPromptTemplate(readWorkflowPromptTemplate(workflowDir, templatePath), values as Record<string, unknown>);
}

export function renderWorkflowAgentTask(workflowDir: string, task: unknown): string {
  if (typeof task === "string") return task;
  if (typeof task !== "object" || task === null || Array.isArray(task))
    throw new Error("agent task must be inline text or an object with template and values");
  const descriptor = task as Record<string, unknown>;
  const unknownKeys = Object.keys(descriptor).filter((key) => key !== "template" && key !== "values");
  if (unknownKeys.length) throw new Error(`agent template task has unknown key '${unknownKeys[0]}'`);
  if (typeof descriptor.template !== "string" || !descriptor.template.trim())
    throw new Error("agent template task template must be a non-empty string");
  if (typeof descriptor.values !== "object" || descriptor.values === null || Array.isArray(descriptor.values))
    throw new Error("agent template task values must be an object");
  const values = descriptor.values as Record<string, unknown>;
  const template = readWorkflowPromptTemplate(workflowDir, descriptor.template);
  const names = strictPlaceholderNames(template, descriptor.template);
  const referenced = new Set(names);
  for (const name of referenced) {
    if (!Object.hasOwn(values, name)) throw new Error(`Prompt template '${descriptor.template}' is missing value '${name}'`);
  }
  for (const name of Object.keys(values)) {
    if (!referenced.has(name)) throw new Error(`Prompt template '${descriptor.template}' does not reference supplied value '${name}'`);
  }
  return renderPromptTemplate(template, values);
}

function readWorkflowPromptTemplate(workflowDir: string, templatePath: string): string {
  const resolvedTemplate = resolvePromptTemplate(workflowPromptDirectory(workflowDir), templatePath);
  return readFileSync(resolvedTemplate, "utf8");
}

function workflowPromptDirectory(workflowDir: string): string {
  return path.join(workflowDir, "prompts");
}

function resolvePromptTemplate(promptDir: string, templatePath: string): string {
  const resolved = resolveInsideRoot(promptDir, templatePath, "Prompt template escapes workflow prompt directory");
  if (existsSync(resolved)) return resolved;
  throw new Error(`Prompt template not found: ${templatePath}`);
}

function strictPlaceholderNames(template: string, templatePath: string): string[] {
  const names: string[] = [];
  let index = 0;
  while (index < template.length) {
    const opening = template.indexOf("{{", index);
    const closing = template.indexOf("}}", index);
    if (closing >= 0 && (opening < 0 || closing < opening)) throw new Error(`Prompt template '${templatePath}' has malformed placeholder`);
    if (opening < 0) return names;
    const end = template.indexOf("}}", opening + 2);
    if (end < 0) throw new Error(`Prompt template '${templatePath}' has malformed placeholder`);
    const match = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(template.slice(opening + 2, end));
    if (!match) throw new Error(`Prompt template '${templatePath}' has malformed placeholder`);
    names.push(match[1]);
    index = end + 2;
  }
  return names;
}

function promptTemplateValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}
