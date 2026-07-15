import type { WorkflowMetadata } from "../runtime/types.ts";
import { analyzeWorkflowSource } from "./source-analysis.ts";
import { readStaticJsonLiteral } from "./static-literal.ts";

export function parseWorkflowSourceMetadata(source: string, workflowName: string, filePath = "workflow.js"): WorkflowMetadata {
  const { sourceFile, metadataExpression } = analyzeWorkflowSource(source, filePath);
  if (!metadataExpression) throw new Error("workflow.js must export static metadata as `export const metadata = { ... }`");
  const metadata = readStaticJsonLiteral(metadataExpression, sourceFile, "workflow metadata");
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata))
    throw new Error("workflow metadata must be an object literal");
  if ((metadata as { name?: unknown }).name !== workflowName) throw new Error(`Workflow metadata name must be '${workflowName}'`);
  validateWorkflowMetadata(metadata, workflowName);
  return metadata;
}

function validateWorkflowMetadata(metadata: unknown, workflowName: string): asserts metadata is WorkflowMetadata {
  if (typeof metadata !== "object" || metadata === null) throw new Error("workflow.js must export metadata");
  const candidate = metadata as { name?: unknown; description?: unknown; inputInstructions?: unknown; phases?: unknown };
  if (candidate.name !== workflowName) throw new Error(`Workflow metadata name must be '${workflowName}'`);
  if (typeof candidate.description !== "string" || !candidate.description.trim())
    throw new Error("Workflow metadata description must be non-empty");
  if (typeof candidate.inputInstructions !== "string" || !candidate.inputInstructions.trim())
    throw new Error("Workflow metadata inputInstructions must describe how to resolve command input");
  if (!Array.isArray(candidate.phases) || candidate.phases.length === 0)
    throw new Error("Workflow metadata phases must list at least one planned phase");
  candidate.phases.forEach((phase, index) => {
    if (typeof phase !== "object" || phase === null) throw new Error(`Workflow metadata phases[${String(index)}] must be an object`);
    const planned = phase as { title?: unknown; detail?: unknown };
    if (typeof planned.title !== "string" || !planned.title.trim())
      throw new Error(`Workflow metadata phases[${String(index)}].title must be non-empty`);
    if (planned.detail !== undefined && typeof planned.detail !== "string")
      throw new Error(`Workflow metadata phases[${String(index)}].detail must be a string when present`);
  });
}
