/** Provides direct LLM completion behavior. */
import { Check } from "typebox/value";
import {
  reasoningLevels,
  type ReasoningLevel,
  type WorkflowLLMMessage,
  type WorkflowLLMRequest,
  type WorkflowLLMSnapshot,
} from "../types.ts";
import type { WorkflowPrimitive } from "../context.ts";
import { requireWorkflowObjectSchema } from "../../workflow-schema.ts";
import { llmStructuredOutputPrompt } from "../../prompt-templates.ts";
import { appendRunMessage } from "../messages.ts";
import { errorMessage } from "../../errors.ts";
import { writeWorkflowLLMOutput, writeWorkflowLLMPrompt } from "../../workflow/outputs.ts";
import { unknownWorkflowCost } from "../usage.ts";

interface WorkflowLLMOptions {
  system?: string;
  messages?: WorkflowLLMMessage[];
  schema?: unknown;
  model?: string;
  reasoning?: ReasoningLevel;
}

export const llmPrimitive: WorkflowPrimitive<{
  LLM: (prompt: string, options?: WorkflowLLMOptions) => Promise<unknown>;
}> = {
  name: "LLM",
  docs: [
    {
      name: "LLM",
      signature: "LLM(prompt, options?)",
      summary: "Makes one generation-only call with optional model, reasoning, system instructions, prior messages, and schema.",
    },
  ],
  globals: ({ runtime }) => ({
    LLM: async (prompt: unknown, inputOptions: unknown = {}) => {
      if (typeof prompt !== "string") throw new TypeError("LLM prompt must be a string");
      if (!isRecord(inputOptions)) throw new TypeError("LLM options must be an object");
      const { system, messages: priorMessages, schema, model, reasoning } = inputOptions;
      if (system !== undefined && typeof system !== "string") throw new TypeError("LLM system must be a string");
      if (priorMessages !== undefined && !Array.isArray(priorMessages)) throw new TypeError("LLM messages must be an array");
      if (model !== undefined && (typeof model !== "string" || !model.trim())) throw new TypeError("LLM model must be a non-empty string");
      const modelSpec = typeof model === "string" ? model.trim() : undefined;
      const reasoningLevel = reasoningLevels.find((level) => level === reasoning);
      if (reasoning !== undefined && reasoningLevel === undefined)
        throw new TypeError("LLM reasoning must be off, minimal, low, medium, high, or xhigh");
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
        ...(modelSpec === undefined ? {} : { model: modelSpec }),
        ...(reasoningLevel === undefined ? {} : { reasoning: reasoningLevel }),
        ...(runtime.options.signal === undefined ? {} : { signal: runtime.options.signal }),
      };
      const llm: WorkflowLLMSnapshot = {
        id: runtime.snapshot.llms.length + 1,
        phaseIndex: runtime.snapshot.phases.length,
        phase: runtime.snapshot.phases.at(-1),
        model: modelSpec,
        reasoning: reasoningLevel,
        status: "running",
        startedAt: Date.now(),
        inputTokenCount: 0,
        cacheReadTokenCount: 0,
        outputTokenCount: 0,
        cost: unknownWorkflowCost(),
      };
      runtime.snapshot.llms.push(llm);
      appendRunMessage(runtime, {
        phaseIndex: llm.phaseIndex,
        ...(llm.phase ? { phase: llm.phase } : {}),
        level: "info",
        message: `LLM #${String(llm.id)} started`,
      });
      runtime.emit();
      try {
        if (runtime.options.outputsDir) {
          llm.promptPath = await writeWorkflowLLMPrompt(runtime.options.outputsDir, llm.id, request);
          runtime.emit();
        }
        const completion = await runtime.options.llm(request);
        llm.inputTokenCount = completion.usage.input;
        llm.cacheReadTokenCount = completion.usage.cacheRead;
        llm.outputTokenCount = completion.usage.output;
        llm.cost = completion.cost;
        if (completion.model !== undefined) llm.model = completion.model;
        llm.provider = completion.provider;
        llm.stopReason = completion.stopReason;
        if (runtime.options.outputsDir) {
          llm.outputPath = await writeWorkflowLLMOutput(runtime.options.outputsDir, llm.id, completion);
        }
        const output: unknown = objectSchema === undefined ? null : (JSON.parse(completion.text) as unknown);
        if (objectSchema !== undefined && !Check(objectSchema, output)) throw new Error("LLM structured output does not match its schema");
        llm.status = "done";
        llm.endedAt = Date.now();
        appendRunMessage(runtime, {
          phaseIndex: llm.phaseIndex,
          ...(llm.phase ? { phase: llm.phase } : {}),
          level: "info",
          message: `LLM #${String(llm.id)} done`,
        });
        runtime.emit();
        return {
          text: completion.text,
          output,
          usage: completion.usage,
          model: completion.model ?? null,
          provider: completion.provider ?? null,
          stopReason: completion.stopReason ?? null,
        };
      } catch (error) {
        llm.status = "error";
        llm.endedAt = Date.now();
        llm.error = errorMessage(error);
        appendRunMessage(runtime, {
          phaseIndex: llm.phaseIndex,
          ...(llm.phase ? { phase: llm.phase } : {}),
          level: "error",
          message: `LLM #${String(llm.id)} error: ${llm.error}`,
        });
        runtime.emit();
        throw error;
      }
    },
  }),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
