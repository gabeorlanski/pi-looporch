/** Provides direct LLM completion behavior. */
import { Check } from "typebox/value";
import type { WorkflowLLMMessage, WorkflowLLMRequest } from "../types.ts";
import type { WorkflowPrimitive } from "../context.ts";
import { requireWorkflowObjectSchema } from "../../workflow-schema.ts";
import { llmStructuredOutputPrompt } from "../../prompt-templates.ts";

interface WorkflowLLMOptions {
  system?: string;
  messages?: WorkflowLLMMessage[];
  schema?: unknown;
}

export const llmPrimitive: WorkflowPrimitive<{
  LLM: (prompt: string, options?: WorkflowLLMOptions) => Promise<unknown>;
}> = {
  name: "LLM",
  docs: [
    {
      name: "LLM",
      signature: "LLM(prompt, options?)",
      summary: "Makes one generation-only call with optional system instructions, prior messages, and schema.",
    },
  ],
  globals: ({ runtime }) => ({
    LLM: async (prompt: unknown, inputOptions: unknown = {}) => {
      if (typeof prompt !== "string") throw new TypeError("LLM prompt must be a string");
      if (!isRecord(inputOptions)) throw new TypeError("LLM options must be an object");
      const { system, messages: priorMessages, schema } = inputOptions;
      if (system !== undefined && typeof system !== "string") throw new TypeError("LLM system must be a string");
      if (priorMessages !== undefined && !Array.isArray(priorMessages)) throw new TypeError("LLM messages must be an array");
      const objectSchema = schema === undefined ? undefined : requireWorkflowObjectSchema(schema, "LLM");
      const messages: WorkflowLLMMessage[] = [
        ...(priorMessages ?? []).map((message, index): WorkflowLLMMessage => {
          if (!isRecord(message)) throw new TypeError(`LLM messages[${String(index)}] must be an object`);
          const { role, content } = message;
          if (role !== "user" && role !== "assistant") throw new TypeError(`LLM messages[${String(index)}] role must be user or assistant`);
          if (typeof content !== "string") throw new TypeError(`LLM messages[${String(index)}] content must be a string`);
          return { role, content };
        }),
        { role: "user", content: prompt },
      ];
      const schemaPrompt = objectSchema === undefined ? undefined : llmStructuredOutputPrompt(objectSchema);
      const systemPrompt = [system, schemaPrompt].filter((part): part is string => part !== undefined).join("\n\n");
      const request: WorkflowLLMRequest = {
        messages,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        ...(runtime.options.signal === undefined ? {} : { signal: runtime.options.signal }),
      };
      const completion = await runtime.options.llm(request);
      const output: unknown = objectSchema === undefined ? null : (JSON.parse(completion.text) as unknown);
      if (objectSchema !== undefined && !Check(objectSchema, output)) throw new Error("LLM structured output does not match its schema");
      return {
        text: completion.text,
        output,
        usage: completion.usage ?? null,
        model: completion.model ?? null,
        provider: completion.provider ?? null,
        stopReason: completion.stopReason ?? null,
      };
    },
  }),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
