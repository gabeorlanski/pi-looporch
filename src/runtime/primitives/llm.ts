/** Provides direct LLM completion behavior. */
import { Check } from "typebox/value";
import {
  reasoningLevels,
  type ReasoningLevel,
  type WorkflowLLMMessage,
  type WorkflowLLMRequest,
  type WorkflowLLMSnapshot,
} from "../types.ts";
import { nextExecutionId, type WorkflowPrimitive } from "../context.ts";
import { requireWorkflowObjectSchema } from "../../workflow-schema.ts";
import { llmStructuredOutputPrompt } from "../../prompt-templates.ts";
import { appendRunMessage } from "../messages.ts";
import { errorMessage } from "../../errors.ts";
import { writeWorkflowLLMOutput, writeWorkflowLLMPrompt } from "../../workflow/outputs.ts";
import { checkpointHash } from "../checkpoint-hash.ts";
import { cloneSerializable } from "../serialization.ts";

interface WorkflowLLMOptions {
  system?: string;
  messages?: WorkflowLLMMessage[];
  schema?: unknown;
  retries?: number;
  model?: string;
  reasoning?: ReasoningLevel;
}

export const llmPrimitive: WorkflowPrimitive<{
  LLM: (prompt: string, options?: WorkflowLLMOptions) => Promise<unknown>;
}> = {
  docs: [
    {
      signature: "LLM(prompt, options?)",
      summary:
        "Makes a generation-only call with optional model, reasoning, system instructions, prior messages, schema, and structured-output retries.",
    },
  ],
  globals: ({ runtime }) => ({
    LLM: async (prompt: unknown, inputOptions: unknown = {}) => {
      if (typeof prompt !== "string") throw new TypeError("LLM prompt must be a string");
      if (!isRecord(inputOptions)) throw new TypeError("LLM options must be an object");
      const { system, messages: priorMessages, schema, retries: inputRetries, model, reasoning } = inputOptions;
      if (system !== undefined && typeof system !== "string") throw new TypeError("LLM system must be a string");
      if (priorMessages !== undefined && !Array.isArray(priorMessages)) throw new TypeError("LLM messages must be an array");
      if (inputRetries !== undefined && (typeof inputRetries !== "number" || !Number.isInteger(inputRetries) || inputRetries < 0)) {
        throw new TypeError("LLM retries must be a non-negative integer");
      }
      const retries = inputRetries ?? 3;
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
      const cacheRequest = {
        messages: request.messages,
        system: request.system,
        model: request.model,
        reasoning: request.reasoning,
      };
      const executionId = nextExecutionId(runtime, "llm", checkpointHash(cacheRequest));
      const requestHash = checkpointHash({
        ...cacheRequest,
        adapter: await runtime.options.llm.cacheContext?.(request),
      });
      const checkpoint = await runtime.options.checkpoints?.get("llm", executionId, requestHash);
      if (checkpoint?.kind === "llm") {
        const phase = runtime.snapshot.phases.at(-1);
        const llm: WorkflowLLMSnapshot = {
          ...checkpoint.snapshot,
          id: runtime.snapshot.llms.length + 1,
          phaseIndex: runtime.snapshot.phases.length,
          ...(phase ? { phase } : {}),
          status: "done",
        };
        if (!phase) delete llm.phase;
        runtime.snapshot.llms.push(llm);
        appendRunMessage(runtime, {
          phaseIndex: llm.phaseIndex,
          ...(llm.phase ? { phase: llm.phase } : {}),
          level: "info",
          message: `LLM #${String(llm.id)} started`,
        });
        appendRunMessage(runtime, {
          phaseIndex: llm.phaseIndex,
          ...(llm.phase ? { phase: llm.phase } : {}),
          level: "info",
          message: `LLM #${String(llm.id)} done`,
        });
        runtime.emit();
        return cloneSerializable(checkpoint.result);
      }
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
        cost: { knownUsd: 0, complete: false },
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
        let attemptRequest = request;
        let usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
        for (let attempt = 0; ; attempt += 1) {
          if (runtime.options.outputsDir) {
            llm.promptPath = await writeWorkflowLLMPrompt(runtime.options.outputsDir, llm.id, attempt + 1, attemptRequest);
            runtime.emit();
          }
          const completion = await runtime.options.llm(attemptRequest);
          usage = {
            input: usage.input + completion.usage.input,
            output: usage.output + completion.usage.output,
            cacheRead: usage.cacheRead + completion.usage.cacheRead,
            cacheWrite: usage.cacheWrite + completion.usage.cacheWrite,
            total: usage.total + completion.usage.total,
          };
          llm.inputTokenCount = usage.input;
          llm.cacheReadTokenCount = usage.cacheRead;
          llm.outputTokenCount = usage.output;
          llm.cost =
            attempt === 0
              ? completion.cost
              : {
                  knownUsd: llm.cost.knownUsd + completion.cost.knownUsd,
                  complete: llm.cost.complete && completion.cost.complete,
                };
          if (completion.model !== undefined) llm.model = completion.model;
          llm.provider = completion.provider;
          llm.stopReason = completion.stopReason;
          if (runtime.options.outputsDir) {
            llm.outputPath = await writeWorkflowLLMOutput(runtime.options.outputsDir, llm.id, attempt + 1, completion);
          }
          let output: unknown;
          try {
            output = objectSchema === undefined ? null : (JSON.parse(completion.text) as unknown);
            if (objectSchema !== undefined && !Check(objectSchema, output))
              throw new Error("LLM structured output does not match its schema");
          } catch (error) {
            if (attempt === retries) throw error;
            const failure = errorMessage(error);
            appendRunMessage(runtime, {
              phaseIndex: llm.phaseIndex,
              ...(llm.phase ? { phase: llm.phase } : {}),
              level: "warning",
              message: `LLM #${String(llm.id)} structured-output retry ${String(attempt + 1)} of ${String(retries)}: ${failure}`,
            });
            attemptRequest = {
              ...request,
              messages: [
                ...attemptRequest.messages,
                { role: "assistant", content: completion.text },
                {
                  role: "user",
                  content: `Your previous response was not valid structured output: ${failure}\nReturn exactly one corrected JSON value. Include every required property, use only permitted properties, and satisfy every schema constraint. Do not use Markdown fences or explanatory prose.`,
                },
              ],
            };
            runtime.emit();
            continue;
          }
          const result = {
            text: completion.text,
            output,
            usage,
            model: completion.model ?? null,
            provider: completion.provider ?? null,
            stopReason: completion.stopReason ?? null,
          };
          llm.status = "done";
          llm.endedAt = Date.now();
          appendRunMessage(runtime, {
            phaseIndex: llm.phaseIndex,
            ...(llm.phase ? { phase: llm.phase } : {}),
            level: "info",
            message: `LLM #${String(llm.id)} done`,
          });
          if (runtime.options.checkpoints) {
            await runtime.options.checkpoints.put({
              kind: "llm",
              executionId,
              requestHash,
              result,
              snapshot: { ...llm },
            });
          }
          runtime.emit();
          return result;
        }
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
