/** Provides the canonical workflow JSON object-schema boundary. */
import type { TSchema } from "typebox";

/** A JSON object schema accepted by workflow structured-output surfaces. */
export interface WorkflowObjectSchema extends TSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: unknown;
  propertyNames?: unknown;
}

/** Validates and narrows a workflow-provided JSON schema. */
export function requireWorkflowObjectSchema(schema: unknown, owner: string): WorkflowObjectSchema {
  if (!isWorkflowObjectSchema(schema)) throw new TypeError(`${owner} schema must be an object schema with properties`);
  return schema;
}

function isWorkflowObjectSchema(schema: unknown): schema is WorkflowObjectSchema {
  return isRecord(schema) && schema.type === "object" && isRecord(schema.properties);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
