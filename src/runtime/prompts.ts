import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveInsideRoot } from "../workflow/paths.ts";

export function renderPromptTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/{{\s*([A-Za-z_$][\w$]*)\s*}}/g, (_match, key: string) => promptTemplateValue(context[key]));
}

export function renderWorkflowPrompt(workflowDir: string, templatePath: string, values: unknown): string {
  if (typeof templatePath !== "string" || !templatePath.trim()) throw new Error("renderPrompt templatePath must be non-empty");
  if (typeof values !== "object" || values === null || Array.isArray(values)) throw new Error("renderPrompt values must be an object");
  const resolvedTemplate = resolvePromptTemplate(workflowPromptDirectory(workflowDir), templatePath);
  return renderStrictPromptTemplate(readFileSync(resolvedTemplate, "utf8"), values as Record<string, unknown>, templatePath);
}

function workflowPromptDirectory(workflowDir: string): string {
  return path.join(workflowDir, "prompts");
}

function resolvePromptTemplate(promptDir: string, templatePath: string): string {
  const resolved = resolveInsideRoot(promptDir, templatePath, "Prompt template escapes workflow prompt directory");
  if (existsSync(resolved)) return resolved;
  throw new Error(`Prompt template not found: ${templatePath}`);
}

function renderStrictPromptTemplate(template: string, values: Record<string, unknown>, templatePath: string): string {
  const names = [...template.matchAll(/{{\s*([A-Za-z_$][\w$]*)\s*}}/g)].map((match) => match[1]);
  const referenced = new Set(names);
  for (const name of referenced) {
    if (!Object.hasOwn(values, name)) throw new Error(`Prompt template '${templatePath}' is missing value '${name}'`);
  }
  for (const name of Object.keys(values)) {
    if (!referenced.has(name)) throw new Error(`Prompt template '${templatePath}' does not reference supplied value '${name}'`);
  }
  return renderPromptTemplate(template, values);
}

function promptTemplateValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}
