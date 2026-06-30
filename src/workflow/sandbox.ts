import vm from "node:vm";
import { analyzeWorkflowSource, type SourceEdit } from "./source-analysis.ts";

export type WorkflowFunction = (input: unknown) => unknown;

export function compileWorkflow(
  source: string,
  filePath: string,
  globals: Record<string, unknown>,
): { metadata: unknown; workflow: WorkflowFunction } {
  const context = vm.createContext({ ...globals });
  const script = new vm.Script(
    `${transformWorkflowModule(source, filePath)}\n;({ metadata: typeof metadata === "undefined" ? undefined : metadata, workflow: typeof workflow === "undefined" ? undefined : workflow });`,
    { filename: filePath },
  );
  const exports = script.runInContext(context, { timeout: 1000 }) as { metadata?: unknown; workflow?: unknown };
  if (typeof exports.workflow !== "function") throw new Error("workflow.js must export a default function");
  return { metadata: exports.metadata, workflow: exports.workflow as WorkflowFunction };
}

function transformWorkflowModule(source: string, filePath: string): string {
  return applySourceEdits(source, analyzeWorkflowSource(source, filePath).moduleEdits);
}

function applySourceEdits(source: string, edits: SourceEdit[]): string {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce((updated, edit) => `${updated.slice(0, edit.start)}${edit.replacement}${updated.slice(edit.end)}`, source);
}
