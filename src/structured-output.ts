import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TUnsafe } from "typebox";
import { Check } from "typebox/value";

type Output = Record<string, unknown>;
type OutputParameters = TUnsafe<Output>;

export interface StructuredOutput {
  tool: ToolDefinition<OutputParameters>;
  result(): Output | undefined;
}

export function createStructuredOutput(schema: unknown): StructuredOutput {
  let value: Output | undefined;
  const parameters = outputParams(schema) as unknown as OutputParameters;

  return {
    tool: {
      name: "StructuredOutput",
      label: "Structured Output",
      description: "Submit the final structured result and end this agent session.",
      parameters,
      execute: (_toolCallId, params, _signal, _onUpdate, ctx) => {
        if (!Check(parameters, params)) return Promise.reject(new Error("StructuredOutput arguments do not match its schema"));
        value = params;
        ctx.abort();
        return Promise.resolve({
          content: [{ type: "text", text: "Structured output accepted." }],
          details: {},
        });
      },
    },
    result: () => value,
  };
}

function outputParams(schema: unknown): Record<string, unknown> {
  if (!isRecord(schema) || schema.type !== "object" || !isRecord(schema.properties))
    throw new Error("StructuredOutput schema must be an object schema with properties");

  const runtimeProperties = ["name", "steps", "usage"];
  for (const name of ["message", ...runtimeProperties]) {
    if (Object.hasOwn(schema.properties, name) || (Array.isArray(schema.required) && schema.required.includes(name)))
      throw new Error(`StructuredOutput schema cannot define reserved property ${JSON.stringify(name)}`);
  }

  return {
    ...schema,
    properties: {
      message: { type: "string", description: "Optional human-readable context for this result." },
      ...schema.properties,
    },
    propertyNames: {
      allOf: [...(schema.propertyNames === undefined ? [] : [schema.propertyNames]), { not: { enum: runtimeProperties } }],
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
