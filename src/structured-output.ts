/** Provides terminal structured-output tool behavior. */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TUnsafe } from "typebox";
import { Check } from "typebox/value";
import { requireWorkflowObjectSchema } from "./workflow-schema.ts";

type Output = Record<string, unknown>;
type OutputParameters = TUnsafe<Output>;

export interface StructuredOutput {
  tool: ToolDefinition<OutputParameters>;
  result(): Output | undefined;
}

/** Creates a terminal StructuredOutput tool that validates and retains one schema-conforming result. */
export function createStructuredOutput(schema: unknown): StructuredOutput {
  let value: Output | undefined;
  const objectSchema = requireWorkflowObjectSchema(schema, "StructuredOutput");
  const reservedFields = ["message", "name", "steps", "usage"];
  for (const name of reservedFields) {
    if (Object.hasOwn(objectSchema.properties, name) || (Array.isArray(objectSchema.required) && objectSchema.required.includes(name)))
      throw new Error(`StructuredOutput schema cannot define reserved property ${JSON.stringify(name)}`);
  }
  const parameters = objectSchema as unknown as OutputParameters;

  return {
    tool: {
      name: "StructuredOutput",
      label: "Structured Output",
      description: "Submit the final structured result required by the task and end this agent session.",
      parameters,
      execute: (_toolCallId, params) => {
        const reservedField = reservedFields.find((name) => Object.hasOwn(params, name));
        if (reservedField)
          return Promise.reject(new Error(`StructuredOutput arguments contain reserved runtime field ${JSON.stringify(reservedField)}`));
        if (!Check(parameters, params)) return Promise.reject(new Error("StructuredOutput arguments do not match its schema"));
        value = params;
        return Promise.resolve({
          content: [{ type: "text", text: "Structured output accepted." }],
          details: {},
        });
      },
    },
    result: () => value,
  };
}
