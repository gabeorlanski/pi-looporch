/** Provides Pi direct model-call integration for workflow LLM completions. */
import { clampThinkingLevel, completeSimple, type Api, type Message, type Model } from "@earendil-works/pi-ai/compat";
import type { WorkflowLLM, WorkflowLLMRequest } from "./runtime/types.ts";
import { resolveWorkflowModel } from "./model-selection.ts";

/** Creates a generation-only workflow adapter using Pi's active model and authentication. */
export function createPiWorkflowLLM(options: {
  model: Model<Api> | undefined;
  getModels?: () => readonly Model<Api>[];
  getRequestAuth: (model: Model<Api>) => Promise<{
    apiKey?: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
  }>;
  complete?: typeof completeSimple;
}): WorkflowLLM {
  const resolveModel = (request: WorkflowLLMRequest): Model<Api> | undefined =>
    request.model !== undefined
      ? resolveWorkflowModel(options.getModels?.() ?? (options.model ? [options.model] : []), request.model)
      : options.model;
  const llm: WorkflowLLM = async (request) => {
    const model = resolveModel(request);
    if (!model)
      throw new Error(
        request.model ? `Direct LLM model ${JSON.stringify(request.model)} was not found` : "Direct LLM calls require an active Pi model",
      );
    const reasoning = request.reasoning === undefined ? undefined : clampThinkingLevel(model, request.reasoning);
    const auth = await options.getRequestAuth(model);
    const messages: Message[] = request.messages.map((message) => {
      if (message.role === "user") return { role: "user", content: message.content, timestamp: 0 };
      return {
        role: "assistant",
        content: [{ type: "text", text: message.content }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 0,
      };
    });
    const response = await (options.complete ?? completeSimple)(
      model,
      {
        ...(request.system ? { systemPrompt: request.system } : {}),
        messages,
        tools: [],
      },
      {
        ...auth,
        maxRetries: 0,
        ...(reasoning === undefined || reasoning === "off" ? {} : { reasoning }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
    );
    if (response.stopReason === "aborted") throw new Error(response.errorMessage ?? "Direct LLM call aborted");
    if (response.stopReason === "error") throw new Error(response.errorMessage ?? "Direct LLM provider call failed");
    return {
      text: response.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join(""),
      usage: {
        input: response.usage.input,
        output: response.usage.output,
        cacheRead: response.usage.cacheRead,
        cacheWrite: response.usage.cacheWrite,
        total: response.usage.totalTokens,
      },
      cost: { knownUsd: response.usage.cost.total, complete: true },
      model: model.id,
      provider: model.provider,
      stopReason: response.stopReason,
    };
  };
  llm.cacheContext = (request) => {
    const model = resolveModel(request);
    return {
      model: model ? { provider: model.provider, id: model.id } : undefined,
      reasoning: model && request.reasoning !== undefined ? clampThinkingLevel(model, request.reasoning) : request.reasoning,
    };
  };
  return llm;
}
