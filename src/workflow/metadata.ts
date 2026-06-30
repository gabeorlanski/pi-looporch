import * as ts from "typescript";
import type { WorkflowMetadata } from "../runtime/types.ts";
import { analyzeWorkflowSource } from "./source-analysis.ts";

export function parseWorkflowSourceMetadata(source: string, workflowName: string, filePath = "workflow.js"): WorkflowMetadata {
  const { sourceFile, metadataExpression } = analyzeWorkflowSource(source, filePath);
  if (!metadataExpression) throw new Error("workflow.js must export static metadata as `export const metadata = { ... }`");
  const metadata = literalValue(metadataExpression, sourceFile, "metadata");
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

function literalValue(node: ts.Expression, sourceFile: ts.SourceFile, path: string): unknown {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element, index) => {
      if (ts.isSpreadElement(element)) throw new Error(`workflow metadata ${path}[${String(index)}] cannot use spread syntax`);
      return literalValue(element, sourceFile, `${path}[${String(index)}]`);
    });
  }
  if (ts.isObjectLiteralExpression(node)) return objectLiteralValue(node, sourceFile, path);
  throw new Error(`workflow metadata ${path} must be static JSON-like literals`);
}

function objectLiteralValue(node: ts.ObjectLiteralExpression, sourceFile: ts.SourceFile, path: string): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) throw new Error(`workflow metadata ${path} can only contain static property assignments`);
    const key = propertyName(property.name, sourceFile, path);
    value[key] = literalValue(property.initializer, sourceFile, `${path}.${key}`);
  }
  return value;
}

function propertyName(name: ts.PropertyName, sourceFile: ts.SourceFile, path: string): string {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  throw new Error(`workflow metadata ${path} cannot use computed property ${name.getText(sourceFile)}`);
}
